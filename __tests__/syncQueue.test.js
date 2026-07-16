/**
 * UpdateQueue Unit Tests
 *
 * Verifies offline update queue behavior: accumulation, persistence,
 * drain, and clear semantics.
 */

import { UpdateQueue } from "@/lib/sync/updateQueue";

// Mock localStorage for the test environment
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(global, "localStorage", {
  value: localStorageMock,
  writable: true,
});

describe("UpdateQueue", () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  test("starts empty", () => {
    const queue = new UpdateQueue("test-doc-1");
    expect(queue.isEmpty).toBe(true);
    expect(queue.size).toBe(0);
    expect(queue.getAll()).toHaveLength(0);
  });

  test("enqueue adds items and updates size", () => {
    const queue = new UpdateQueue("test-doc-2");
    queue.enqueue(new Uint8Array([1, 2, 3]));
    queue.enqueue(new Uint8Array([4, 5, 6]));

    expect(queue.size).toBe(2);
    expect(queue.isEmpty).toBe(false);
  });

  test("getAll returns Uint8Arrays in insertion order", () => {
    const queue = new UpdateQueue("test-doc-3");
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([4, 5, 6]);
    queue.enqueue(a);
    queue.enqueue(b);

    const all = queue.getAll();
    expect(all).toHaveLength(2);
    expect(Array.from(all[0])).toEqual([1, 2, 3]);
    expect(Array.from(all[1])).toEqual([4, 5, 6]);
  });

  test("clear empties the queue and persists", () => {
    const queue = new UpdateQueue("test-doc-4");
    queue.enqueue(new Uint8Array([1, 2, 3]));
    queue.clear();

    expect(queue.isEmpty).toBe(true);
    expect(queue.size).toBe(0);

    // Reload from localStorage to verify persistence
    const queue2 = new UpdateQueue("test-doc-4");
    expect(queue2.isEmpty).toBe(true);
  });

  test("persists across instantiations (simulates page reload)", () => {
    const queue1 = new UpdateQueue("test-doc-5");
    queue1.enqueue(new Uint8Array([10, 20, 30]));
    queue1.enqueue(new Uint8Array([40, 50, 60]));

    // Simulate page reload — new instance reads from localStorage
    const queue2 = new UpdateQueue("test-doc-5");
    expect(queue2.size).toBe(2);
    expect(Array.from(queue2.getAll()[0])).toEqual([10, 20, 30]);
  });

  test("different docIds have separate queues", () => {
    const q1 = new UpdateQueue("doc-aaa");
    const q2 = new UpdateQueue("doc-bbb");

    q1.enqueue(new Uint8Array([1]));
    q2.enqueue(new Uint8Array([2]));
    q2.enqueue(new Uint8Array([3]));

    expect(q1.size).toBe(1);
    expect(q2.size).toBe(2);

    q1.clear();
    expect(q1.isEmpty).toBe(true);
    expect(q2.size).toBe(2); // clearing q1 doesn't affect q2
  });

  test("handles large payloads without corruption", () => {
    const queue = new UpdateQueue("test-doc-large");
    const large = new Uint8Array(50000); // 50 KB
    crypto.getRandomValues(large);
    queue.enqueue(large);

    const retrieved = queue.getAll()[0];
    expect(Array.from(retrieved)).toEqual(Array.from(large));
  });

  test("base64 roundtrip is lossless", () => {
    const queue = new UpdateQueue("test-doc-roundtrip");
    // Include bytes that include 0x00 and 0xFF
    const original = new Uint8Array([0, 127, 128, 255, 42, 1, 0]);
    queue.enqueue(original);

    const retrieved = queue.getAll()[0];
    expect(Array.from(retrieved)).toEqual(Array.from(original));
  });
});
