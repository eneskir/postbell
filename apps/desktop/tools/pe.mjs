// Reads a 64-bit Windows exe's DependentLoadFlags (the load configuration field that limits where its own DLL imports
// are searched for), or null when it has none.
export function dependentLoadFlags(buf) {
  const pe = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(pe) !== 0x4550) throw new Error("not a PE file");
  const sections = buf.readUInt16LE(pe + 6);
  const opt = pe + 24;
  if (buf.readUInt16LE(opt) !== 0x20b) throw new Error("not a 64-bit PE file");
  const rva = buf.readUInt32LE(opt + 112 + 10 * 8);
  if (!rva) return null;
  for (let i = 0, s = opt + buf.readUInt16LE(pe + 20); i < sections; i++, s += 40) {
    const va = buf.readUInt32LE(s + 12);
    if (rva >= va && rva < va + buf.readUInt32LE(s + 16)) {
      const at = buf.readUInt32LE(s + 20) + rva - va;
      return buf.readUInt32LE(at) >= 80 ? buf.readUInt16LE(at + 78) : null;
    }
  }
  return null;
}
