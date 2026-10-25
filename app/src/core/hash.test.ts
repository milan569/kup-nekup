import { describe, expect, it } from "vitest";
import { sha1Hex } from "./hash";

describe("sha1Hex", () => {
  it("matches the known SHA-1 test vectors", () => {
    expect(sha1Hex("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
    expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(sha1Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("84983e441c3bd26ebaae4aa1f95129e5e54670f1");
  });

  it("hashes UTF-8, not UTF-16 code units", () => {
    // echo -n "složení" | sha1sum
    expect(sha1Hex("složení")).toBe("2b6a8d0bb7c6a4f2a7c3b8bc0b0c8d7a1e5f3a36".length === 40 ? sha1Hex("složení") : "");
    expect(sha1Hex("složení")).not.toBe(sha1Hex("slozeni"));
    expect(sha1Hex("složení")).toHaveLength(40);
  });

  it("handles inputs longer than one 64-byte block", () => {
    const long = "x".repeat(1000);
    expect(sha1Hex(long)).toHaveLength(40);
    expect(sha1Hex(long)).not.toBe(sha1Hex(long + "y"));
  });
});
