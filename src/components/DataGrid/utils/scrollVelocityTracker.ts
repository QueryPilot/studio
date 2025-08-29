/**
 * Tracks scroll velocity to dynamically adjust overscan
 * Based on VSCode's approach to predict user scrolling patterns
 */
export class ScrollVelocityTracker {
  private positions: Array<{ time: number; position: number }> = [];
  private velocity = 0;
  private lastDirection: 'up' | 'down' | 'none' = 'none';
  private accelerating = false;
  
  // Velocity thresholds (pixels per second)
  private static readonly VELOCITY_SLOW = 100;
  private static readonly VELOCITY_MEDIUM = 500;
  private static readonly VELOCITY_FAST = 1000;
  private static readonly VELOCITY_ULTRA_FAST = 2000;
  
  // Overscan values for different velocities
  private static readonly OVERSCAN_IDLE = 10;
  private static readonly OVERSCAN_SLOW = 20;
  private static readonly OVERSCAN_MEDIUM = 50;
  private static readonly OVERSCAN_FAST = 100;
  private static readonly OVERSCAN_ULTRA_FAST = 150;
  
  /**
   * Update velocity with new scroll position
   */
  update(position: number): void {
    const now = performance.now();
    
    // Detect direction change
    if (this.positions.length > 0) {
      const lastPos = this.positions[this.positions.length - 1];
      if (lastPos) {
        const currentDirection = position > lastPos.position ? 'down' : 
                                position < lastPos.position ? 'up' : 'none';
      
        if (currentDirection !== 'none' && currentDirection !== this.lastDirection) {
          // Direction changed, reset velocity tracking
          this.positions = [];
          this.velocity = 0;
          this.accelerating = false;
        }
        this.lastDirection = currentDirection;
      }
    }
    
    this.positions.push({ time: now, position });
    
    // Keep last 5 samples for smoothing
    if (this.positions.length > 5) {
      this.positions.shift();
    }
    
    // Calculate velocity
    if (this.positions.length >= 2) {
      const oldest = this.positions[0];
      const newest = this.positions[this.positions.length - 1];
      if (oldest && newest) {
        const deltaPosition = Math.abs(newest.position - oldest.position);
        const deltaTime = newest.time - oldest.time;
      
        if (deltaTime > 0) {
          const newVelocity = (deltaPosition / deltaTime) * 1000; // Convert to px/s
          
          // Detect acceleration
          this.accelerating = newVelocity > this.velocity * 1.2;
          
          // Smooth velocity changes
          this.velocity = this.velocity * 0.3 + newVelocity * 0.7;
        }
      }
    }
  }
  
  /**
   * Get current velocity in pixels per second
   */
  getVelocity(): number {
    return Math.abs(this.velocity);
  }
  
  /**
   * Get recommended overscan based on velocity
   */
  getOverscan(): number {
    const vel = this.getVelocity();
    
    // Add extra overscan if accelerating
    const accelerationBonus = this.accelerating ? 20 : 0;
    
    if (vel < ScrollVelocityTracker.VELOCITY_SLOW) {
      return ScrollVelocityTracker.OVERSCAN_IDLE + accelerationBonus;
    }
    if (vel < ScrollVelocityTracker.VELOCITY_MEDIUM) {
      return ScrollVelocityTracker.OVERSCAN_SLOW + accelerationBonus;
    }
    if (vel < ScrollVelocityTracker.VELOCITY_FAST) {
      return ScrollVelocityTracker.OVERSCAN_MEDIUM + accelerationBonus;
    }
    if (vel < ScrollVelocityTracker.VELOCITY_ULTRA_FAST) {
      return ScrollVelocityTracker.OVERSCAN_FAST + accelerationBonus;
    }
    
    return ScrollVelocityTracker.OVERSCAN_ULTRA_FAST;
  }
  
  /**
   * Get scroll direction
   */
  getDirection(): 'up' | 'down' | 'none' {
    return this.lastDirection;
  }
  
  /**
   * Check if user is scrolling fast
   */
  isFastScrolling(): boolean {
    return this.getVelocity() > ScrollVelocityTracker.VELOCITY_FAST;
  }
  
  /**
   * Check if scroll is accelerating
   */
  isAccelerating(): boolean {
    return this.accelerating;
  }
  
  /**
   * Reset velocity tracking
   */
  reset(): void {
    this.positions = [];
    this.velocity = 0;
    this.lastDirection = 'none';
    this.accelerating = false;
  }
  
  /**
   * Get predictive range based on velocity and direction
   */
  getPredictiveRange(
    currentStart: number,
    currentEnd: number,
    maxRows: number
  ): { start: number; end: number } {
    const overscan = this.getOverscan();
    const direction = this.getDirection();
    
    if (direction === 'down') {
      // Scrolling down - prioritize rows below
      const predictiveEnd = Math.min(currentEnd + overscan * 2, maxRows - 1);
      const predictiveStart = Math.max(currentStart - Math.floor(overscan * 0.5), 0);
      return { start: predictiveStart, end: predictiveEnd };
    } else if (direction === 'up') {
      // Scrolling up - prioritize rows above
      const predictiveStart = Math.max(currentStart - overscan * 2, 0);
      const predictiveEnd = Math.min(currentEnd + Math.floor(overscan * 0.5), maxRows - 1);
      return { start: predictiveStart, end: predictiveEnd };
    }
    
    // No direction or idle - balanced overscan
    return {
      start: Math.max(currentStart - overscan, 0),
      end: Math.min(currentEnd + overscan, maxRows - 1)
    };
  }
}