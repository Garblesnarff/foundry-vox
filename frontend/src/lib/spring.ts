export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
  precision: number;
}

export const SPRING_SNAPPY: SpringConfig = { stiffness: 300, damping: 22, mass: 1, precision: 0.01 };
export const SPRING_SOFT: SpringConfig = { stiffness: 120, damping: 14, mass: 1, precision: 0.01 };
export const SPRING_HEAVY: SpringConfig = { stiffness: 80, damping: 10, mass: 1, precision: 0.01 };

export class Spring {
  value: number;
  velocity: number;
  target: number;
  stiffness: number;
  damping: number;
  mass: number;
  precision: number;

  constructor(initial: number, config: Partial<SpringConfig> = {}) {
    const c = { ...SPRING_SNAPPY, ...config };
    this.value = initial;
    this.velocity = 0;
    this.target = initial;
    this.stiffness = c.stiffness;
    this.damping = c.damping;
    this.mass = c.mass;
    this.precision = c.precision;
  }

  setTarget(t: number) {
    this.target = t;
  }

  /** Semi-implicit Euler step. Returns true if still animating. */
  tick(dt: number): boolean {
    // Clamp dt to prevent explosion when tab is backgrounded
    const clamped = Math.min(dt, 0.064);
    const acceleration =
      (this.target - this.value) * this.stiffness / this.mass -
      this.velocity * this.damping / this.mass;
    this.velocity += acceleration * clamped;
    this.value += this.velocity * clamped;

    if (this.isSettled()) {
      this.value = this.target;
      this.velocity = 0;
      return false;
    }
    return true;
  }

  isSettled(): boolean {
    return (
      Math.abs(this.target - this.value) < this.precision &&
      Math.abs(this.velocity) < this.precision
    );
  }
}
