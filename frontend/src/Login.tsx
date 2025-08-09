import React, { useState } from 'react';
import './Login.css';

type Props = {
  onLogin: (username: string, color: string) => void;
};

const colorOptions = [
  "#FFCDD2", "#F8BBD0", "#E1BEE7", "#D1C4E9", "#C5CAE9",
  "#BBDEFB", "#B2EBF2", "#C8E6C9", "#DCEDC8", "#FFF9C4",
  "#FFE0B2", "#FFCCBC", "#D7CCC8", "#26A69A", "#CFD8DC",
  "#F44336", "#E91E63", "#9C27B0", "#673AB7", "#3F51B5",
  "#2196F3", "#03A9F4", "#00BCD4", "#009688", "#4CAF50",
  "#8BC34A", "#CDDC39", "#FFEB3B", "#FFC107", "#FF9800",
  "#FF5722", "#795548", "#607D8B"
];

const Login: React.FC<Props> = ({ onLogin }) => {
  const [isSignup, setIsSignup] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [isResetPassword, setIsResetPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Check URL for reset token on component mount
  React.useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const emailParam = urlParams.get('email');
    
    if (token && emailParam) {
      setResetToken(token);
      setEmail(emailParam);
      setIsResetPassword(true);
      setIsForgotPassword(false);
      setIsSignup(false);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const endpoint = isSignup ? '/auth/signup' : '/login';
    const body = isSignup
      ? {
          email,
          password,
          username: username.trim(),
          color: selectedColor || colorOptions[Math.floor(Math.random() * colorOptions.length)]
        }
      : { email, password };

    if (isSignup && !username.trim()) {
      alert("Username is required");
      return;
    }

    try {
      const response = await fetch(`${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const result = await response.json();
      if (!response.ok) {
        alert(result.error || "Authentication failed");
        return;
      }

      if (isSignup) {
        alert("Signup successful! Please verify your email.");
      } else {
        if (result.sessionToken) {
          localStorage.setItem("session_token", result.sessionToken);
        }
        onLogin(result.username, result.color);
      }
    } catch (error: any) {
      alert("Connection error: " + error.message);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email.trim()) {
      alert("Please enter your email address");
      return;
    }

    try {
      const response = await fetch('/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      const result = await response.json();
      if (!response.ok) {
        alert(result.error || "Failed to send reset email");
        return;
      }

      alert(result.message);
      setIsForgotPassword(false);
      setEmail('');
    } catch (error: any) {
      alert("Connection error: " + error.message);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newPassword || !confirmPassword) {
      alert("Please fill in both password fields");
      return;
    }

    if (newPassword !== confirmPassword) {
      alert("Passwords do not match");
      return;
    }

    if (newPassword.length < 8) {
      alert("Password must be at least 8 characters long");
      return;
    }

    try {
      const response = await fetch('/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          email, 
          token: resetToken, 
          newPassword 
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        alert(result.error || "Failed to reset password");
        return;
      }

      alert(result.message);
      setIsResetPassword(false);
      setResetToken('');
      setNewPassword('');
      setConfirmPassword('');
      setEmail('');
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (error: any) {
      alert("Connection error: " + error.message);
    }
  };

  // Forgot Password Form
  if (isForgotPassword) {
    return (
      <div className="login-container">
        <h2>Reset Password</h2>
        <form onSubmit={handleForgotPassword}>
          <div className="form-group">
            <label>Email:</label>
            <input
              className="login-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email address"
              required
              title="Please enter a valid email address"
              onInvalid={(e) => e.currentTarget.setCustomValidity('Please enter a valid email address')}
              onInput={(e) => e.currentTarget.setCustomValidity('')}
            />
          </div>
          <div className="login-button-group">
            <button className="login-button" type="submit">
              Send Reset Link
            </button>
            <button
              className="login-button"
              type="button"
              onClick={() => {
                setIsForgotPassword(false);
                setEmail('');
              }}
            >
              Back to Login
            </button>
          </div>
        </form>
      </div>
    );
  }

  // Reset Password Form
  if (isResetPassword) {
    return (
      <div className="login-container">
        <h2>Set New Password</h2>
        <form onSubmit={handleResetPassword}>
          <div className="form-group">
            <label>Email:</label>
            <input
              className="login-input"
              type="email"
              value={email}
              disabled
              style={{ backgroundColor: '#f5f5f5' }}
            />
          </div>
          <div className="form-group">
            <label>New Password:</label>
            <input
              className="login-input"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter your new password"
              required
              minLength={8}
              title="Password must be at least 8 characters"
              onInvalid={(e) => e.currentTarget.setCustomValidity('Password must be at least 8 characters')}
              onInput={(e) => e.currentTarget.setCustomValidity('')}
            />
          </div>
          <div className="form-group">
            <label>Confirm Password:</label>
            <input
              className="login-input"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm your new password"
              required
              minLength={8}
              title="Please confirm your password"
              onInvalid={(e) => e.currentTarget.setCustomValidity('Please confirm your password')}
              onInput={(e) => e.currentTarget.setCustomValidity('')}
            />
          </div>
          <div className="login-button-group">
            <button className="login-button" type="submit">
              Reset Password
            </button>
            <button
              className="login-button"
              type="button"
              onClick={() => {
                setIsResetPassword(false);
                setResetToken('');
                setNewPassword('');
                setConfirmPassword('');
                setEmail('');
                window.history.replaceState({}, document.title, window.location.pathname);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    );
  }

  // Main Login/Signup Form
  return (
    <div className="login-container">
      <h2>{isSignup ? "Sign Up" : "Log In"}</h2>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Email:</label>
          <input
            className="login-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter your email"
            required
            title="Please enter a valid email address"
            onInvalid={(e) => e.currentTarget.setCustomValidity('Please enter a valid email address')}
            onInput={(e) => e.currentTarget.setCustomValidity('')}
          />
        </div>
        <div className="form-group">
          <label>Password:</label>
          <input
            className="login-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
            title="Please enter your password"
            onInvalid={(e) => e.currentTarget.setCustomValidity('Please enter your password')}
            onInput={(e) => e.currentTarget.setCustomValidity('')}
          />
        </div>
        
        {!isSignup && (
          <div className="forgot-password-link">
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setIsForgotPassword(true);
                setEmail('');
                setPassword('');
              }}
            >
              Forgot your password?
            </button>
          </div>
        )}
        
        <div className="login-button-group">
          <button className="login-button" type="submit">
            {isSignup ? "Sign Up" : "Log In"}
          </button>
          <button
            className="login-button"
            type="button"
            onClick={() => setIsSignup(!isSignup)}
          >
            {isSignup ? "Log In" : "Sign Up"}
          </button>
        </div>

        {isSignup && (
          <>
            <div className="form-group">
              <label>Username:</label>
              <input
                className="login-input"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                required
                title="Please enter your username"
                onInvalid={(e) => e.currentTarget.setCustomValidity('Please enter your username')}
                onInput={(e) => e.currentTarget.setCustomValidity('')}
              />
            </div>
            <div className="form-group">
              <label>Color Selection:</label>
              <div className="color-picker">
                {colorOptions.map((color) => (
                  <div
                    key={color}
                    onClick={() => setSelectedColor(color)}
                    style={{
                      width: "40px",
                      height: "40px",
                      backgroundColor: color,
                      border: selectedColor === color ? "3px solid black" : "1px solid #888",
                      cursor: "pointer",
                      borderRadius: "4px",
                    }}
                    title={color}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </form>
    </div>
  );
};

export default Login;