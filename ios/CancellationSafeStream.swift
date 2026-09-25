import GRPC

// gRPC-Swift 1.8.0, the newest release on CocoaPods, crashes when the task
// iterating a response stream is cancelled at the wrong moment.
// `PassthroughMessageSource.consumeNextElement()` holds its lock while it
// registers a task cancellation handler, and if the task is already cancelled
// that handler runs on the spot and takes the same lock again. Debug builds
// trap on the relock; release builds deadlock or trap. gRPC-Swift 1.11.0
// replaced this code (grpc/grpc-swift#1477), but only on SwiftPM.
//
// The SDK iterates its response streams from sync tasks, and stopping a
// synchronizer cancels those tasks. `updateSources.ts` routes every one of
// those streams through `cancellationSafeResponses()`, which keeps gRPC's
// stream away from cancellation entirely: an uncancelled task drains it, and
// the RPC itself is cancelled when the consumer goes away.

extension GRPCAsyncServerStreamingCall {
  func cancellationSafeResponses() -> CancellationSafeStream<Response> {
    CancellationSafeStream(responseStream, onCancel: { self.cancel() })
  }
}

struct CancellationSafeStream<Element>: AsyncSequence {
  private let stream: AsyncThrowingStream<Element, Error>

  /// Iterates `upstream` from a task that is never cancelled, so the upstream
  /// iterator never sees a cancellation. When the consumer is cancelled, or
  /// drops the stream before it ends, `onCancel` runs instead; it should make
  /// the upstream finish, which ends the draining task.
  init<Upstream: AsyncSequence & Sendable>(
    _ upstream: Upstream,
    onCancel: @escaping @Sendable () -> Void
  ) where Upstream.Element == Element {
    stream = AsyncThrowingStream { continuation in
      continuation.onTermination = { termination in
        if case .cancelled = termination { onCancel() }
      }
      Task {
        do {
          for try await element in upstream {
            continuation.yield(element)
          }
          continuation.finish()
        } catch {
          continuation.finish(throwing: error)
        }
      }
    }
  }

  func makeAsyncIterator() -> Iterator {
    Iterator(base: stream.makeAsyncIterator())
  }

  struct Iterator: AsyncIteratorProtocol {
    var base: AsyncThrowingStream<Element, Error>.Iterator

    mutating func next() async throws -> Element? {
      guard let element = try await base.next() else {
        // A cancelled consumer sees the stream end early. Report that as the
        // cancellation it is, as gRPC's own stream does, so callers cannot
        // mistake it for the server finishing the response:
        try Task.checkCancellation()
        return nil
      }
      return element
    }
  }
}
