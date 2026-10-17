import fs from 'node:fs';
const before = JSON.parse(fs.readFileSync('.scratch/baseline-before.json', 'utf8'));
const after = JSON.parse(fs.readFileSync('.scratch/baseline-after.json', 'utf8'));

console.log('components index — before (auto-fill) → after (.bn-row + .bn-col-4)');
for (const width of [320, 375, 768, 1024, 1440]) {
  const b = before.pages['components-index'][width];
  const a = after.pages.index[width];
  const bPerRow = b.cardCount / b.cardRows;
  console.log(
    `  @${width}: doc ${b.scrollWidth}→${a.docScroll}/${a.innerWidth}  ` +
      `cards/row ${bPerRow}→${a.perRow}  cardW ${b.cardWidths[0]}→${a.cardWidth}  rows ${b.cardRows}→${Math.ceil(a.cards / a.perRow)}  ` +
      `container ${b.mainBox.w}→${a.container}  grid tracks —→${a.tracks}`,
  );
}
console.log('button component page — before → after');
for (const width of [320, 375, 768, 1024, 1440]) {
  const b = before.pages['components-button'][width];
  const a = after.pages.button[width];
  console.log(
    `  @${width}: doc ${b.scrollWidth}→${a.docScroll}/${a.innerWidth}  overflow ${b.scrollWidth > b.innerWidth}→${a.docScroll > a.innerWidth}  ` +
      `prose ${b.proseWidth}→${a.prose}  container ${b.mainBox.w}→${a.container}  grid tracks —→${a.tracks}`,
  );
}
