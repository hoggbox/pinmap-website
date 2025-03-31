async function register() {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value.trim();
    const username = document.getElementById('username').value.trim();
    const birthdate = document.getElementById('birthdate').value;
    const sex = document.getElementById('sex').value;
    const location = document.getElementById('location').value.trim();
    const profilePicture = document.getElementById('profile-picture').files[0];
  
    if (!email || !password) {
      alert('Email and password are required');
      return;
    }
  
    const formData = new FormData();
    formData.append('email', email);
    formData.append('password', password);
    if (username) formData.append('username', username);
    if (birthdate) formData.append('birthdate', birthdate);
    if (sex) formData.append('sex', sex);
    if (location) formData.append('location', location);
    if (profilePicture) formData.append('profilePicture', profilePicture);
  
    try {
      const response = await fetch('http://localhost:5000/auth/register', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (response.ok) {
        document.getElementById('register-form').style.display = 'none';
        document.getElementById('success-modal').style.display = 'flex';
      } else {
        alert(`Registration failed: ${data.message || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Register error:', err);
      alert('Error connecting to server. Is the backend running?');
    }
  }
  
  function returnToLogin() {
    window.location.href = 'index.html';
  }
  
  // Preview profile picture
  document.getElementById('profile-picture').onchange = (e) => {
    const file = e.target.files[0];
    const preview = document.getElementById('profile-picture-preview');
    if (file) {
      preview.src = URL.createObjectURL(file);
      preview.style.display = 'block';
    } else {
      preview.style.display = 'none';
    }
  };