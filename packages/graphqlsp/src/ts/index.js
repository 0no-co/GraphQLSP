export var ts;
export function init(modules) {
  ts = modules.typescript;
}

export function reset() {
  ts = undefined;
}
