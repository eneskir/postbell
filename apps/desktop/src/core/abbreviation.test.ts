import { test } from "node:test";
import assert from "node:assert/strict";
import { abbreviate } from "./abbreviation.ts";

test("initials: first letters of the first two words, or the first two letters of one word, in Turkish casing", () => {
  assert.deepEqual(abbreviate(["Müşteri A"]), ["MA"]);
  assert.deepEqual(abbreviate(["Pictures"]), ["Pİ"]);
  assert.deepEqual(abbreviate(["istanbul işleri"]), ["İİ"]);
});

test("on a clash the first differing word gains a lowercase letter; only clashing names grow", () => {
  assert.deepEqual(abbreviate(["Müşteri Ayva", "Müşteri Ağa"]), ["MAy", "MAğ"]);
  assert.deepEqual(abbreviate(["Müşteri A", "Mahmut A"]), ["MüA", "MaA"]);
  assert.deepEqual(abbreviate(["Pictures", "Pizza"]), ["Pic", "Piz"]);
  assert.deepEqual(abbreviate(["Müşteri A", "Müşteri Ayva"]), ["MA", "MAy"]);
  assert.deepEqual(abbreviate(["istanbul işleri", "İzmir İşleri"]), ["İsİ", "İzİ"]);
  assert.deepEqual(abbreviate(["Pictures", "Pizza", "Gece Dosyası"]), ["Pic", "Piz", "GD"]);
});

test("a late difference adds one more letter; identical names do not loop forever", () => {
  assert.deepEqual(abbreviate(["Picasso", "Pictures"]), ["Pica", "Pict"]);
  assert.deepEqual(abbreviate(["Pictures", "Pictures"]), ["Pİ", "Pİ"]);
});
