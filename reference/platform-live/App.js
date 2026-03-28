import React, { useState } from 'react';
import './App.css';

function App() {
  const [theme, setTheme] = useState('dark');

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
    document.body.className = theme === 'dark' ? 'light' : '';
  };

  return (
    <div className={`app ${theme === 'light' ? 'light' : ''}`}>
      <div className="grid-bg"></div>
      <div className="orb"></div>

      <nav className="nav">
        <div className="nav-logo">
          <img src="https://metatron.id/wp-content/uploads/2026/03/metatron-_Logo.png" alt="metatron logo" style={{height: '42px'}} />
        </div>
        <div className="nav-right">
          <button className="theme-toggle" onClick={toggleTheme}>
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
      </nav>

      <div className="login-wrap">
        <div className="login-box">
          <div className="login-hero">
            <div>🌍</div>
            <h1 className="login-title">Welcome to <span>metatron</span></h1>
            <p className="login-sub">The intelligence layer connecting founders, investors, and ecosystem partners globally.</p>
          </div>
          <p className="label">I am a</p>
          <div className="role-grid">
            <div className="role-card">
              <span className="role-icon">🚀</span>
              <div className="role-name">Founder</div>
              <div className="role-desc">Raise capital</div>
            </div>
            <div className="role-card">
              <span className="role-icon">💼</span>
              <div className="role-name">Investor</div>
              <div className="role-desc">Deploy capital</div>
            </div>
            <div className="role-card">
              <span className="role-icon">🔗</span>
              <div className="role-name">Connector</div>
              <div className="role-desc">Facilitate deals</div>
            </div>
          </div>
          <p>Select your role to continue</p>
        </div>
      </div>
    </div>
  );
}

export default App;
