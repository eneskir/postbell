const upper = (s: string) => s.toLocaleUpperCase("tr-TR");
const lower = (s: string) => s.toLocaleLowerCase("tr-TR");

function wordsOf(name: string): string[] {
  return name.trim().split(/\s+/u).filter(Boolean);
}

function render(words: readonly string[], counts: readonly number[]): string {
  if (words.length === 1 && counts[0] === 2) return upper([...(words[0] ?? "")].slice(0, 2).join(""));
  return counts
    .map((n, i) => {
      const letters = [...(words[i] ?? "")].slice(0, n);
      return letters.length ? upper(letters[0] ?? "") + lower(letters.slice(1).join("")) : "";
    })
    .join("");
}

export function abbreviate(names: readonly string[]): string[] {
  const words = names.map(wordsOf);
  const counts = words.map((w) => (w.length >= 2 ? [1, 1] : [2]));
  for (let round = 0; round < 64; round++) {
    const shown = words.map((w, i) => render(w, counts[i] ?? []));
    const clusters = new Map<string, number[]>();
    shown.forEach((s, i) => clusters.set(s, [...(clusters.get(s) ?? []), i]));
    let grew = false;
    for (const members of clusters.values()) {
      if (members.length < 2) continue;
      const lists = members.map((i) => words[i] ?? []);
      const longest = Math.max(...lists.map((l) => l.length));
      let d = 0;
      while (d < longest && lists.every((l) => lower(l[d] ?? "") === lower(lists[0]?.[d] ?? ""))) d++;
      if (d >= longest) continue;
      for (const i of members) {
        const c = counts[i];
        const w = words[i];
        if (!c || !w || d >= w.length) continue;
        while (c.length <= d) c.push(0);
        if (c[d]! < [...w[d]!].length) {
          c[d]! += 1;
          grew = true;
        }
      }
    }
    if (!grew) return shown;
  }
  return words.map((w, i) => render(w, counts[i] ?? []));
}
