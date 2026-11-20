/** @param {string} id @param {string} name @param {string} hint @param {string[]} cards @param {string} empty */
export const stageModule = (id, name, hint, cards, empty) => `<section class="module m-${id}" aria-label="${name}">
<div class="module-head"><span class="led"></span><h2>${name}</h2><span class="hint">${hint}</span><span class="readout">${String(cards.length).padStart(2, "0")}</span></div>
<div class="stack">${cards.length ? cards.join("") : `<div class="empty">${empty}</div>`}</div>
</section>`;
