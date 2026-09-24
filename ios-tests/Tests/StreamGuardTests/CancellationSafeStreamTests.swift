import Foundation
@testable import GRPC
@testable import StreamGuard
import XCTest

final class CancellationSafeStreamTests: XCTestCase {
  typealias Source = PassthroughMessageSource<Int, Error>

  func testUnguardedStreamTrapsWhenCancelled() throws {
    let result = try runRepro("raw")
    XCTAssertEqual(result.reason, .uncaughtSignal)
    XCTAssertEqual(result.status, SIGTRAP)
    XCTAssertTrue(result.output.contains("lock() failed in pthread_mutex"), result.output)
  }

  func testGuardedStreamThrowsWhenCancelled() throws {
    let result = try runRepro("guarded")
    XCTAssertEqual(result.reason, .exit)
    XCTAssertEqual(result.status, 0)
    XCTAssertEqual(result.output, "threw CancellationError\n")
  }

  func testGuardedStreamSurvivesCancellationDuringDelivery() throws {
    let result = try runRepro("stress-guarded", "2000")
    XCTAssertEqual(result.reason, .exit)
    XCTAssertEqual(result.status, 0)
    XCTAssertTrue(result.output.hasSuffix("survived\n"), result.output)
  }

  func testDeliversElementsThenFinishes() async throws {
    let source = Source()
    for element in 1 ... 3 { _ = source.yield(element) }
    _ = source.finish()

    var received: [Int] = []
    for try await element in guarded(source) { received.append(element) }
    XCTAssertEqual(received, [1, 2, 3])
  }

  func testDeliversElementsThenUpstreamError() async throws {
    struct Failure: Error {}
    let source = Source()
    for element in 1 ... 2 { _ = source.yield(element) }
    _ = source.finish(throwing: Failure())

    var received: [Int] = []
    do {
      for try await element in guarded(source) { received.append(element) }
      XCTFail("expected the upstream error")
    } catch {
      XCTAssertTrue(error is Failure)
    }
    XCTAssertEqual(received, [1, 2])
  }

  func testCancellingConsumerCancelsUpstream() async throws {
    let source = Source()
    let cancelled = expectation(description: "upstream cancelled")
    let stream = guarded(source) {
      cancelled.fulfill()
      _ = source.finish(throwing: CancellationError())
    }
    _ = source.yield(1)

    let consumer = Task {
      var iterator = stream.makeAsyncIterator()
      let first = try await iterator.next()
      XCTAssertEqual(first, 1)
      // Nothing more arrives, so this waits until the task is cancelled:
      _ = try await iterator.next()
    }
    try await Task.sleep(nanoseconds: 50_000_000)
    consumer.cancel()

    await fulfillment(of: [cancelled], timeout: 5)
    do {
      try await consumer.value
      XCTFail("expected cancellation")
    } catch {
      XCTAssertTrue(error is CancellationError)
    }
  }

  func testDroppingStreamCancelsUpstream() async {
    let source = Source()
    let cancelled = expectation(description: "upstream cancelled")
    do {
      _ = guarded(source) {
        cancelled.fulfill()
        _ = source.finish()
      }
    }
    await fulfillment(of: [cancelled], timeout: 5)
  }

  func testFinishedStreamDoesNotCancelUpstream() async throws {
    let source = Source()
    let cancelled = expectation(description: "upstream cancelled")
    cancelled.isInverted = true
    let stream = guarded(source) { cancelled.fulfill() }
    _ = source.finish()

    for try await _ in stream {}
    await fulfillment(of: [cancelled], timeout: 0.2)
  }

  private func guarded(
    _ source: Source,
    onCancel: @escaping @Sendable () -> Void = {}
  ) -> CancellationSafeStream<Int> {
    CancellationSafeStream(PassthroughMessageSequence(consuming: source), onCancel: onCancel)
  }

  private struct ReproResult {
    let reason: Process.TerminationReason
    let status: Int32
    let output: String
  }

  /// Runs the CancelRepro executable, which sits next to the test bundle.
  private func runRepro(_ arguments: String...) throws -> ReproResult {
    let executable = Bundle(for: Self.self).bundleURL
      .deletingLastPathComponent()
      .appendingPathComponent("CancelRepro")
    let pipe = Pipe()
    let process = Process()
    process.executableURL = executable
    process.arguments = arguments
    process.standardOutput = pipe
    process.standardError = pipe
    try process.run()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    return ReproResult(
      reason: process.terminationReason,
      status: process.terminationStatus,
      output: String(decoding: data, as: UTF8.self)
    )
  }
}
