// Public entry for squad / enemy soldiers (implementation lives in enemies.js next to the animation layer).
//   createSoldier({ side: 'opfor' | 'hv', weapon: 'ak74' | 'akm' | 'ak4c', helmet?: boolean }) -> guard object
//   poseSoldier(g, { walk, speed, aim, flash, hit, dead, fallDir })   (same state as poseGuard)
export { createSoldier, poseSoldier, createGuard, poseGuard } from '../enemies.js';
