// The shop: themed sets of skins bought with points, each a kart livery, a
// helmet and a suit in one look (paint.js SHOP_LIVERIES, driver.js
// SHOP_DESIGNS, suits.js SHOP_SUITS). Each month the shop has two themes
// in; the next month two others, round all of them in turn. And the
// artists' music (music.js ARTISTS), each artist on their own, always in. Points come from
// driving (POINTS); what you buy is yours for good. The record lives with the
// driver's stats (profile.js): points earned, and what was bought for what,
// so the balance is the one minus the other, and two computers' records
// merge without losing a purchase or a point.

import { rarityOf } from './rarity.js';

export const THEMES = ['scales', 'circuit', 'galaxy', 'shatter', 'topo', 'zebra', 'digital', 'inferno'];
export const THEME_NAMES = { scales: 'Dragon scale', circuit: 'Circuit', galaxy: 'Galaxy', shatter: 'Shattered',
  topo: 'Topographic', zebra: 'Zebra', digital: 'Digital camo', inferno: 'Inferno' };
export const KINDS = { livery: 'Kart livery', helmet: 'Helmet', suit: 'Suit' };
// prices: by kind, more for the rarer sets (rarity.js)
export const PRICE = { helmet: 1000, suit: 1500, livery: 2000 };
// the artists' music: item `music:${id}`
export const MUSIC = { adamholt: { price: 1000 }, marloboys: { price: 1000 } };
const RARITY_PRICE = { common: 1, uncommon: 1, rare: 1, epic: 1.5, legendary: 2 };
export const priceOf = (kind, theme) => Math.round(PRICE[kind] * (RARITY_PRICE[rarityOf(kind, theme)] ?? 1));
// accounts that have every item, to try them out (Ezra_Langley)
export const TESTERS = new Set(['8c894d35-d15a-44ad-875a-587d0fe6bfc9']);
// what driving earns
export const POINTS = { lap: 10, best: 50, fastestLap: 100, top10: 150, top1: 500 };
const PER_MONTH = 2;

// an item's id: `${kind}:${theme}`
export const itemId = (kind, theme) => `${kind}:${theme}`;
export const parseItem = (id) => { const [kind, theme] = id.split(':'); return { kind, theme }; };

const monthIndex = (d) => (d.getFullYear() - 2026) * 12 + d.getMonth();
// the themes in the shop in the month of date d
export function themesFor(d = new Date()) {
  const m = monthIndex(d), out = [];
  for (let i = 0; i < PER_MONTH; i++) out.push(THEMES[(((m * PER_MONTH + i) % THEMES.length) + THEMES.length) % THEMES.length]);
  return out;
}
// this month's items, sets in order
export const shopItems = (d = new Date()) => themesFor(d).flatMap(t => Object.keys(KINDS).map(k => ({ id: itemId(k, t), kind: k, theme: t, price: priceOf(k, t) })));
// when the shop changes next (the 1st of next month, local time)
export function nextReset(d = new Date()) { return new Date(d.getFullYear(), d.getMonth() + 1, 1); }

// the wallet, from a driver's stats data ({ points, owned: { id: price } })
export const spent = (data) => Object.values(data.owned || {}).reduce((s, p) => s + (+p || 0), 0);
export const balance = (data) => Math.max(0, (data.points || 0) - spent(data));
export const owns = (data, kind, theme) => !!data.owned?.[itemId(kind, theme)];
