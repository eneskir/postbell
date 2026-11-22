import assert from "node:assert/strict";
import { test } from "node:test";
import { dependentLoadFlags } from "./pe.mjs";

// The smallest layout the reader walks: DOS header, PE header, one section holding the load configuration.
function exe({ magic = 0x20b, configRva = 0x1000, configSize = 80, flags = 0x800 } = {}) {
  const b = Buffer.alloc(0x400);
  b.writeUInt32LE(0x40, 0x3c);
  b.writeUInt32LE(0x4550, 0x40);
  b.writeUInt16LE(1, 0x46);
  b.writeUInt16LE(240, 0x54);
  b.writeUInt16LE(magic, 0x58);
  b.writeUInt32LE(configRva, 0x58 + 112 + 80);
  const section = 0x58 + 240;
  b.writeUInt32LE(0x1000, section + 12);
  b.writeUInt32LE(0x200, section + 16);
  b.writeUInt32LE(0x200, section + 20);
  b.writeUInt32LE(configSize, 0x200);
  b.writeUInt16LE(flags, 0x200 + 78);
  return b;
}

test("reads the flags from the load configuration", () => {
  assert.equal(dependentLoadFlags(exe()), 0x800);
  assert.equal(dependentLoadFlags(exe({ flags: 0 })), 0);
});

test("an exe without the field or the configuration has no flags", () => {
  assert.equal(dependentLoadFlags(exe({ configSize: 64 })), null);
  assert.equal(dependentLoadFlags(exe({ configRva: 0 })), null);
  assert.equal(dependentLoadFlags(exe({ configRva: 0x5000 })), null);
});

test("refuses a file that is not a 64-bit exe", () => {
  assert.throws(() => dependentLoadFlags(exe({ magic: 0x10b })), /64-bit/);
  assert.throws(() => dependentLoadFlags(Buffer.alloc(0x100)), /PE/);
});
