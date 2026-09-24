// Reproduces the gRPC-Swift 1.8.0 cancellation crash and shows that
// CancellationSafeStream avoids it. The tests run this as a subprocess,
// since the unguarded case kills the process.
//
//   CancelRepro raw           consume a gRPC response stream from a cancelled
//                             task (traps in consumeNextElement)
//   CancelRepro guarded       the same, through CancellationSafeStream
//   CancelRepro stress-raw    the SDK's blockStream shape, cancelled while
//   CancelRepro stress-guarded  blocks arrive, many times over

import Foundation
@testable import GRPC
@testable import StreamGuard

typealias Source = PassthroughMessageSource<Int, Error>

func makeResponseStream(_ source: Source) -> GRPCAsyncResponseStream<Int> {
  GRPCAsyncResponseStream(PassthroughMessageSequence(consuming: source))
}

/// Mirrors LightWalletGRPCService.blockStream: an unfolding stream that pulls
/// from the response stream's iterator.
func sdkShapedStream<Upstream: AsyncSequence>(
  _ upstream: Upstream
) -> AsyncThrowingStream<Int, Error> where Upstream.Element == Int {
  var iterator = upstream.makeAsyncIterator()
  return AsyncThrowingStream {
    try await iterator.next()
  }
}

func cancelCurrentTask() {
  withUnsafeCurrentTask { $0?.cancel() }
}

/// Consumes gRPC's message sequence from a cancelled task. This is the
/// crashing frame without the race around it: `GRPCAsyncResponseStream`
/// checks for cancellation first, so the SDK only reaches this state when the
/// cancellation lands between that check and `consumeNextElement()`.
func consumeCancelled(guarded: Bool) async -> String {
  let source = Source()
  let messages = PassthroughMessageSequence(consuming: source)
  let task = Task { () -> String in
    cancelCurrentTask()
    do {
      if guarded {
        let stream = CancellationSafeStream(messages, onCancel: {
          _ = source.finish(throwing: CancellationError())
        })
        for try await _ in stream {}
      } else {
        for try await _ in messages {}
      }
      return "finished"
    } catch {
      return "threw \(type(of: error))"
    }
  }
  return await task.value
}

/// Cancels a consumer at random points while a producer delivers blocks.
func stress(guarded: Bool, rounds: Int) async {
  for round in 0 ..< rounds {
    let source = Source()
    let upstream: AnyAsyncSequence
    if guarded {
      upstream = AnyAsyncSequence(CancellationSafeStream(makeResponseStream(source), onCancel: {
        _ = source.finish(throwing: CancellationError())
      }))
    } else {
      upstream = AnyAsyncSequence(makeResponseStream(source))
    }
    let blocks = sdkShapedStream(upstream)
    let consumer = Task {
      var count = 0
      do {
        for try await _ in blocks {
          count += 1
        }
      } catch {}
      return count
    }
    let producer = Task.detached {
      for block in 0 ..< 200 {
        _ = source.yield(block)
        if block % 7 == 0 { await Task.yield() }
      }
      _ = source.finish()
    }
    try? await Task.sleep(nanoseconds: UInt64.random(in: 0 ... 20000))
    consumer.cancel()
    _ = await consumer.value
    await producer.value
    if round % 1000 == 0 { print("round \(round)") }
  }
}

/// Type-erases the two upstream variants so both run the same code.
struct AnyAsyncSequence: AsyncSequence {
  typealias Element = Int
  let make: () -> Iterator

  init<S: AsyncSequence>(_ sequence: S) where S.Element == Int {
    make = {
      var iterator = sequence.makeAsyncIterator()
      return Iterator(next: { try await iterator.next() })
    }
  }

  func makeAsyncIterator() -> Iterator { make() }

  struct Iterator: AsyncIteratorProtocol {
    let next: () async throws -> Int?
    mutating func next() async throws -> Int? { try await next() }
  }
}

let mode = CommandLine.arguments.dropFirst().first ?? ""
let rounds = Int(CommandLine.arguments.dropFirst(2).first ?? "") ?? 20000
switch mode {
case "raw": print(await consumeCancelled(guarded: false))
case "guarded": print(await consumeCancelled(guarded: true))
case "stress-raw": await stress(guarded: false, rounds: rounds); print("survived")
case "stress-guarded": await stress(guarded: true, rounds: rounds); print("survived")
default:
  print("usage: CancelRepro raw|guarded|stress-raw|stress-guarded [rounds]")
  exit(2)
}
