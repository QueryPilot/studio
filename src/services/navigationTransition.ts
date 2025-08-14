/**
 * Navigation transition helper
 * Provides smooth transitions when navigating between screens
 */

export const navigationTransition = {
  /**
   * Add fade-out effect before navigation
   */
  async fadeOut() {
    const root = document.getElementById('root');
    if (root) {
      root.style.transition = 'opacity 0.2s ease-out';
      root.style.opacity = '0';
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  },

  /**
   * Add fade-in effect after navigation
   */
  async fadeIn() {
    const root = document.getElementById('root');
    if (root) {
      root.style.opacity = '0';
      root.style.transition = 'opacity 0.2s ease-in';
      // Force reflow
      void root.offsetHeight;
      root.style.opacity = '1';
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  },

  /**
   * Navigate with smooth transition
   */
  async navigate(url: string) {
    await this.fadeOut();
    window.location.href = url;
  }
};