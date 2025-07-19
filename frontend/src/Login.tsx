import React, { useState } from 'react';
import './Login.css';

type Props = {
  onLogin: (username: string, color: string) => void;
};

const colorOptions = [
  "#FFCDD2", "#F8BBD0", "#E1BEE7", "#D1C4E9", "#C5CAE9",
  "#BBDEFB", "#B2EBF2", "#C8E6C9", "#DCEDC8", "#FFF9C4"
];

const Login: React.FC<Props> = ({ onLogin }) => {
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [selectedColor, setSelectedColor] = useState<string | null>(null);

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
          />
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
        <div className="button-group">
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
      </form>
    </div>
  );
};

export default Login;