import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, sheetXml, zipStored, xlsxFile, XLSX_TYPE } from "../src/xlsx.js";

const dec = new TextDecoder();
const u32 = (b, at) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const u16 = (b, at) => b[at] | (b[at + 1] << 8);
// Walk the central directory the way a reader does and hand back each part.
function unzip(b) {
  const end = b.length - 22;
  assert.equal(u32(b, end), 0x06054b50, "end of central directory");
  const n = u16(b, end + 10), cdAt = u32(b, end + 16);
  const parts = {};
  let at = cdAt;
  for (let i = 0; i < n; i++) {
    assert.equal(u32(b, at), 0x02014b50);
    const crc = u32(b, at + 16), size = u32(b, at + 20), nameLen = u16(b, at + 28), off = u32(b, at + 42);
    const name = dec.decode(b.slice(at + 46, at + 46 + nameLen));
    assert.equal(u32(b, off), 0x04034b50, "local header of " + name);
    const dataAt = off + 30 + u16(b, off + 26) + u16(b, off + 28);
    const data = b.slice(dataAt, dataAt + size);
    assert.equal(crc32(data), crc, "crc of " + name);
    parts[name] = dec.decode(data);
    at += 46 + nameLen;
  }
  return parts;
}

test("crc32 and a stored zip a reader can walk", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
  const z = zipStored([{ name: "a.txt", data: new TextEncoder().encode("hello") }, { name: "d/b.txt", data: new TextEncoder().encode("") }]);
  assert.deepEqual([...z.slice(0, 4)], [0x50, 0x4b, 3, 4]);
  assert.deepEqual(unzip(z), { "a.txt": "hello", "d/b.txt": "" });
});

test("the order sheet: SKU as text, name escaped, quantity as a number", () => {
  const rows = [["SKU", "Product Name", "Quantity"], ["195166150611", "MTG BLOOMBURROW PLAY BOOSTER BOX", 1], ["0012345", 'Dragon Shield "Matte" Black & Co <v1>', 1]];
  const x = xlsxFile("Order", rows, [18, 60, 10]);
  const parts = unzip(x);
  assert.deepEqual(Object.keys(parts).sort(), ["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
  const sheet = parts["xl/worksheets/sheet1.xml"];
  assert.match(sheet, /<row r="1"><c r="A1" t="inlineStr"><is><t xml:space="preserve">SKU<\/t><\/is><\/c><c r="B1" t="inlineStr"><is><t xml:space="preserve">Product Name<\/t><\/is><\/c><c r="C1" t="inlineStr"><is><t xml:space="preserve">Quantity<\/t><\/is><\/c><\/row>/);
  assert.match(sheet, /<c r="A2" t="inlineStr"><is><t xml:space="preserve">195166150611<\/t><\/is><\/c>/, "a UPC stays text");
  assert.match(sheet, /<c r="C2"><v>1<\/v><\/c>/, "quantity is a number");
  assert.match(sheet, /<t xml:space="preserve">0012345<\/t>/, "leading zeros kept");
  assert.match(sheet, /Dragon Shield &quot;Matte&quot; Black &amp; Co &lt;v1&gt;/);
  assert.match(sheet, /<col min="2" max="2" width="60" customWidth="1"\/>/);
  assert.match(parts["xl/workbook.xml"], /<sheet name="Order" sheetId="1" r:id="rId1"\/>/);
  assert.equal(XLSX_TYPE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  // a sheet name with characters Excel forbids is cleaned; an empty cell is skipped
  assert.match(unzip(xlsxFile("A/B:C?", [["x", "", 2]]))["xl/workbook.xml"], /name="A B C "/);
  assert.equal(sheetXml([["x", "", 2]]).includes('r="B1"'), false);
});
