// Login form logic
document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const submitBtn = document.getElementById('submitBtn');
  const btnText = document.getElementById('btnText');
  const btnSpinner = document.getElementById('btnSpinner');
  const errorMessage = document.getElementById('errorMessage');

  // Custom Toast helper
  function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span>${message}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(20px)';
      toast.style.transition = 'all 0.5s ease';
      setTimeout(() => toast.remove(), 500);
    }, 3000);
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Reset state
    errorMessage.style.display = 'none';
    errorMessage.textContent = '';
    
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
      errorMessage.textContent = 'Por favor, completa todos los campos.';
      errorMessage.style.display = 'block';
      return;
    }

    // Set loading state
    submitBtn.disabled = true;
    btnText.style.display = 'none';
    btnSpinner.style.display = 'inline-block';

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Ocurrió un error al iniciar sesión.');
      }

      showToast('Inicio de sesión exitoso. Redirigiendo...', 'success');
      
      // Save session
      Auth.saveSession(data.token, data.user);
      
      // Redirect
      setTimeout(() => {
        window.location.href = '/dashboard.html';
      }, 1000);

    } catch (error) {
      console.error('Login error:', error);
      errorMessage.textContent = error.message;
      errorMessage.style.display = 'block';
      
      // Reset button state
      submitBtn.disabled = false;
      btnText.style.display = 'inline';
      btnSpinner.style.display = 'none';
      
      showToast(error.message, 'danger');
    }
  });
});
