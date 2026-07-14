// Authentication Helpers for Carwash App

const Auth = {
  // Save token and user info to localStorage
  saveSession(token, user) {
    localStorage.setItem('carwash_token', token);
    localStorage.setItem('carwash_user', JSON.stringify(user));
  },

  // Get JWT token from storage
  getToken() {
    return localStorage.getItem('carwash_token');
  },

  // Get user info object
  getUser() {
    const userStr = localStorage.getItem('carwash_user');
    try {
      return userStr ? JSON.parse(userStr) : null;
    } catch (e) {
      this.logout();
      return null;
    }
  },

  // Check if user is logged in
  isLoggedIn() {
    return !!this.getToken() && !!this.getUser();
  },

  // Get auth headers for fetch requests
  getHeaders(extraHeaders = {}) {
    const token = this.getToken();
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...extraHeaders
    };
  },

  // Clear session and redirect to login
  logout() {
    localStorage.removeItem('carwash_token');
    localStorage.removeItem('carwash_user');
    window.location.href = '/login.html';
  },

  // Verify token with backend, redirect if invalid
  async verifySession() {
    if (!this.isLoggedIn()) {
      window.location.href = '/login.html';
      return false;
    }

    try {
      const response = await fetch('/api/auth/me', {
        headers: this.getHeaders()
      });

      if (!response.ok) {
        this.logout();
        return false;
      }
      
      const data = await response.json();
      localStorage.setItem('carwash_user', JSON.stringify(data.user));
      return data.user;
    } catch (error) {
      console.error('Session verification failed:', error);
      // Don't log out on network failure, only on auth rejection
      return this.getUser();
    }
  },

  // Check role authorization and redirect if unauthorized
  authorize(allowedRoles) {
    const user = this.getUser();
    if (!user || !allowedRoles.includes(user.role)) {
      alert('Acceso no autorizado.');
      window.location.href = '/dashboard.html';
      return false;
    }
    return true;
  }
};
