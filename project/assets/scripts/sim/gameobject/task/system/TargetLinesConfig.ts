/**
 * Verbatim from redalert2/src/game/gameobject/task/system/TargetLinesConfig.ts.
 *
 * The path-preview payload handed from a task up to the renderer. It is a plain
 * object rather than a class because the renderer compares snapshots to decide
 * whether the line changed; `configsAreEqual` does **reference** comparison on
 * `pathNodes` and `target` on purpose — a task that rebuilds an identical path
 * allocates a new array and therefore does redraw, which is what you want when
 * the unit's tile changed but the path did not.
 */
export interface TargetLinesConfig {
    isAttack?: boolean;
    pathNodes?: any[];
    target?: any;
}

export function cloneConfig(config: TargetLinesConfig | undefined): TargetLinesConfig | undefined {
    return config ? { ...config } : undefined;
}

export function configsAreEqual(
    config1: TargetLinesConfig | undefined,
    config2: TargetLinesConfig | undefined,
): boolean {
    return (
        (!config1 && !config2) ||
        (config1?.isAttack === config2?.isAttack &&
            config1?.pathNodes === config2?.pathNodes &&
            config1?.target === config2?.target)
    );
}

export function configHasTarget(config: TargetLinesConfig | undefined): boolean {
    return !(!config?.pathNodes?.length && !config?.target);
}
