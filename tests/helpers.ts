import { vi, type Mock } from "vitest";
import type { WaveClient } from "../src/client.js";

export type FakeClient = WaveClient & { query: Mock; mutate: Mock };

export function fakeClient(): FakeClient {
  return { businessId: "BIZ", query: vi.fn(), mutate: vi.fn() } as FakeClient;
}
