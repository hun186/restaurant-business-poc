'use strict';
// Shared pure unit conversion and integer-cent rounding for local SQLite
// pricing and Cloudflare D1 estimates. No filesystem, DB, clock or network.
const grams=new Map([['kg',1000],['公斤',1000],['千克',1000],
  ['g',1],['公克',1],['克',1]]);
const milliliters=new Map([['L',1000],['l',1000],['公升',1000],
  ['升',1000],['ml',1],['mL',1],['毫升',1]]);
function conversion(qty,from,to){
 if(from===to)return qty;
 if(grams.has(from)&&grams.has(to))return qty*grams.get(from)/grams.get(to);
 if(milliliters.has(from)&&milliliters.has(to))
  return qty*milliliters.get(from)/milliliters.get(to);
 return null;
}
function roundedCents(quantity,unitPriceCents){
 return Math.round(quantity*unitPriceCents);
}
module.exports={conversion,roundedCents};
