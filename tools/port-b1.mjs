/**
 * B1 port helper — copies reference files verbatim into the project.
 *
 * Anything that is pure TypeScript with no `three` / DOM / VFS dependency is
 * copied byte for byte; only the import specifiers are rewritten to the local
 * layout. Hand-written files (the vector / matrix / quaternion layer, which the
 * reference inherits from three.js) are NOT produced here.
 *
 * Run:  node tools/port-b1.mjs --force
 *
 * **This is a one-shot generator.** Every file it writes has since been
 * hand-polished: `QuadTree` imports `../math/*` instead of `@/game/math/*`,
 * `LandType` dropped the obsolete `TileKind` mapper (terrain is now the
 * reference `TerrainType`), `PowerupType` gained `UNSUPPORTED_POWERUP_TYPES`.
 * Re-running without `--force` would silently undo all of that, so the guard
 * below refuses by default.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

if (!process.argv.includes('--force')) {
    console.error(
        '[port-b1] refused: this generator overwrites hand-polished B1 output.\n' +
            '          Re-run with --force only if you intend to re-port from scratch.',
    );
    process.exit(1);
}

const ROOT = resolve(process.cwd());
const SRC = resolve(ROOT, 'RedAlert2-Android-main/redalert2/src');
const SIM = resolve(ROOT, 'project/assets/scripts/sim');

/** [source, dest, replacements[]] */
const JOBS = [
    ['game/math/GameMath.ts', 'math/GameMath.ts', [
        ["import { isBetween } from '../../util/math';", "import { isBetween } from '../util/math';"],
    ]],
    ['game/Coords.ts', 'Coords.ts', [
        ["import { GameMath } from './math/GameMath';", "import { GameMath } from './math/GameMath';"],
        ["import { Vector2 } from './math/Vector2';", "import { Vector2 } from './math/Vector2';"],
        ["import { Vector3 } from './math/Vector3';", "import { Vector3 } from './math/Vector3';"],
    ]],
    ['util/math.ts', 'util/math.ts', []],
    ['util/typeGuard.ts', 'util/typeGuard.ts', []],
    ['util/array.ts', 'util/array.ts', []],
    ['util/number.ts', 'util/number.ts', []],
    ['util/string.ts', 'util/string.ts', []],
    ['util/format.ts', 'util/format.ts', [["import { pad } from './string';", "import { pad } from './string';"]]],
    ['util/event.ts', 'util/event.ts', []],
    // util/Graph.ts is already merged (with NodeHeap / SearchStatePool /
    // PathFinder) into sim/Graph.ts — copying it again would duplicate it.
    ['util/QuadTree.ts', 'util/QuadTree.ts', []],
];

const TYPE_JOBS = [
    'game/type/ArmorType.ts',
    'game/type/LandTargeting.ts',
    'game/type/LocomotorType.ts',
    'game/type/MovementZone.ts',
    'game/type/NavalTargeting.ts',
    'game/type/PipColor.ts',
    'game/type/PowerupType.ts',
    'game/type/SpeedType.ts',
    'game/type/SuperWeaponType.ts',
    'game/type/VhpScan.ts',
];

function write(dest, body) {
    const full = resolve(SIM, dest);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body, 'utf8');
    const lines = body.split('\n').length;
    console.log(`  ${dest.padEnd(34)} ${String(lines).padStart(5)} lines`);
}

console.log('--- verbatim copies ---');
for (const [src, dest, repl] of JOBS) {
    let body = readFileSync(resolve(SRC, src), 'utf8');
    for (const [from, to] of repl) {
        if (body.includes(from)) body = body.split(from).join(to);
    }
    write(dest, body);
}

console.log('--- game/type ---');
for (const src of TYPE_JOBS) {
    const name = src.split('/').pop();
    let body = readFileSync(resolve(SRC, src), 'utf8');
    // LandType depends on engine/type/TerrainType; it is hand-ported separately
    if (name === 'LocomotorType.ts') {
        body = body.replace("from './SpeedType'", "from './SpeedType'");
    }
    write(`type/${name}`, body);
}

/* LandType: the reference maps engine TerrainType -> LandType. We keep the enum
 * and emit a TerrainKind map of our own, because our terrain vocabulary is ours. */
{
    let body = readFileSync(resolve(SRC, 'game/type/LandType.ts'), 'utf8');
    body = body
        .replace("import { TerrainType } from '@/engine/type/TerrainType';\n", '')
        .replace(/const terrainToLandTypeMap[\s\S]*$/, '');
    body = body.trimEnd() + '\n';
    // append our own mapping, driven by the project's TileKind
    body += `
/**
 * Our theatre vocabulary -> LandType.
 *
 * The reference reads the engine's TerrainType (a tile-art property) and throws
 * on anything unknown. We generate terrain procedurally, so the mapping lives
 * here and every kind we can emit has a LandType.
 */
import { TileKind } from '../world/Terrain';

const terrainToLandTypeMap = new Map<TileKind, LandType>([
    [TileKind.Sand, LandType.Clear],
    [TileKind.Dune, LandType.Rough],
    [TileKind.Rock, LandType.Rock],
    [TileKind.Crystal, LandType.Tiberium],
    [TileKind.Road, LandType.Road],
    [TileKind.Water, LandType.Water],
]);

export function getLandType(terrainType: TileKind, solidify = false): LandType {
    if (solidify) return LandType.Cliff;
    const mapped = terrainToLandTypeMap.get(terrainType);
    if (mapped === undefined) throw new Error(\`Unknown terrain type \${terrainType}\`);
    return mapped;
}
`;
    write('type/LandType.ts', body);
}

console.log('done');
