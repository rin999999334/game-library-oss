export type RouteMotion = 'none' | 'tab' | 'forward' | 'back';
type Transition = { skipTransition: () => void; ready: Promise<void>; finished: Promise<void> };
type MotionHost = {
  start?: (update: () => void) => Transition;
  reduced: () => boolean;
  setKind: (kind: RouteMotion | null) => void;
};

// A skipped transition can still run its update callback later. Only the newest
// navigation may commit, including when the next navigation has no animation.
export function createRouteMotion(host: MotionHost) {
  let revision = 0, active: Transition | undefined;
  return {
    run(kind: RouteMotion, update: () => void) {
      const current = ++revision;
      active?.skipTransition(); active = undefined;
      let committed = false;
      const commit = () => {
        if (current !== revision || committed) return;
        committed = true; update();
      };
      if (!host.start || kind === 'none' || host.reduced()) {
        host.setKind(null); commit(); return;
      }
      host.setKind(kind);
      try {
        const transition = host.start(commit); active = transition;
        void transition.ready.catch(() => {});
        const finish = () => { if (current === revision) { active = undefined; host.setKind(null); } };
        void transition.finished.then(finish, finish);
      } catch { host.setKind(null); commit(); }
    },
    dispose() { ++revision; active?.skipTransition(); active = undefined; host.setKind(null); },
  };
}
