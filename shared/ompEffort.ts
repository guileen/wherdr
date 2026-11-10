// omp's thinking levels: accepted by `--thinking`, and the order ⇧⇥ cycles
// through them (off → auto → the model's own levels, in catalog order).
// One source for the launch validation, the pane controls and the catalog.
export const OMP_EFFORT_LEVELS: readonly string[] = ['off', 'auto', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
