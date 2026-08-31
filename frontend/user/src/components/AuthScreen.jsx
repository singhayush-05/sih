import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import ThemeToggle from './ThemeToggle';
import { auth, saveSession } from '../services/api';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

export const AuthScreen = ({ onLogin, isDark: externalIsDark, setIsDark: externalSetIsDark }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [internalIsDark, setInternalIsDark] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [upiId, setUpiId] = useState('');
  const [loading, setLoading] = useState(false);
  const googleBtnRef = useRef(null);

  const isDark = externalIsDark !== undefined ? externalIsDark : internalIsDark;
  const toggleTheme = (newValue) => {
    const nextVal = typeof newValue === 'boolean' ? newValue : !isDark;
    if (externalSetIsDark) {
      externalSetIsDark(nextVal);
    } else {
      setInternalIsDark(nextVal);
    }
  };

  const callbackRef = useRef(null);
  const gsiInitializedRef = useRef(false);

  const handleGoogleCredentialResponse = useCallback(async (response) => {
    if (!response || !response.credential) {
      toast.error("No credential received from Google");
      return;
    }

    setLoading(true);
    try {
      const res = await auth.googleLogin({ credential: response.credential });
      saveSession(res.data);
      toast.success(`Welcome, ${res.data.full_name || 'User'}!`);
      if (onLogin) onLogin();
    } catch (err) {
      toast.error(err.detail || err.message || 'Google authentication failed');
    } finally {
      setLoading(false);
    }
  }, [onLogin]);

  useEffect(() => {
    callbackRef.current = handleGoogleCredentialResponse;
  }, [handleGoogleCredentialResponse]);

  // One-time Google Identity Services initialization
  useEffect(() => {
    const clientId = GOOGLE_CLIENT_ID;
    if (!clientId) return;

    const initGsi = () => {
      if (window.google?.accounts?.id && !gsiInitializedRef.current) {
        try {
          window.google.accounts.id.initialize({
            client_id: clientId,
            callback: (res) => {
              if (callbackRef.current) {
                callbackRef.current(res);
              }
            },
            auto_select: false,
            cancel_on_tap_outside: true,
          });
          gsiInitializedRef.current = true;
        } catch (e) {
          console.warn("GSI initialization error:", e);
        }
      }
    };

    if (window.google?.accounts?.id) {
      initGsi();
    } else {
      const interval = setInterval(() => {
        if (window.google?.accounts?.id) {
          clearInterval(interval);
          initGsi();
        }
      }, 200);
      return () => clearInterval(interval);
    }
  }, []);

  // Separate effect for rendering Google button when DOM ref, theme, or login mode changes
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    const renderGsiButton = () => {
      if (window.google?.accounts?.id && googleBtnRef.current) {
        try {
          googleBtnRef.current.innerHTML = '';
          window.google.accounts.id.renderButton(googleBtnRef.current, {
            theme: isDark ? 'filled_black' : 'outline',
            size: 'large',
            width: 340,
            text: isLogin ? 'signin_with' : 'signup_with',
            shape: 'pill',
          });
        } catch (e) {
          console.warn("GSI button render warning:", e);
        }
      }
    };

    if (window.google?.accounts?.id && gsiInitializedRef.current) {
      renderGsiButton();
    } else {
      const timer = setInterval(() => {
        if (window.google?.accounts?.id && gsiInitializedRef.current && googleBtnRef.current) {
          clearInterval(timer);
          renderGsiButton();
        }
      }, 200);
      return () => clearInterval(timer);
    }
  }, [isDark, isLogin]);


  const handleCustomGoogleClick = () => {
    if (!GOOGLE_CLIENT_ID) {
      toast.error("Google Client ID is not configured in frontend .env (VITE_GOOGLE_CLIENT_ID)");
      return;
    }
    if (window.google?.accounts?.id) {
      window.google.accounts.id.prompt();
    } else {
      toast.error("Google Sign-In is still loading. Please try again in a moment.");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please fill in email and password");
      return;
    }
    setLoading(true);

    try {
      if (isLogin) {
        const res = await auth.login({ email, password });
        saveSession(res.data);
        toast.success(`Welcome back, ${res.data.full_name || 'User'}!`);
        if (onLogin) onLogin();
      } else {
        if (!fullName) {
          toast.error("Please enter your full name");
          setLoading(false);
          return;
        }
        await auth.register({
          email,
          password,
          full_name: fullName,
          phone: phone || undefined,
          upi_id: upiId || `${email.split('@')[0]}@upi`,
        });

        // Automatically log in
        const res = await auth.login({ email, password });
        saveSession(res.data);
        toast.success("Account created successfully!");
        if (onLogin) onLogin();
      }
    } catch (err) {
      toast.error(err.detail || err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row bg-(--color-pure-white) dark:bg-(--color-obsidian) font-sans select-none transition-colors duration-300">
      {/* Left Panel (Editorial Accent) */}
      <div className="w-full md:w-2/5 bg-(--color-electric-lime) dark:bg-(--color-iris-gleam) p-8 md:p-14 flex flex-col justify-between shrink-0 min-h-80 md:min-h-screen transition-colors duration-300">
        {/* Top Left: Brand Name */}
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-(--color-off-black-ink) dark:text-white">
            RakshaPay
          </h1>
        </div>

        {/* Bottom Left: Tagline & Heading */}
        <div className="mt-12 md:mt-0">
          <p className="text-(length:--text-caption) uppercase font-bold tracking-widest text-(--color-off-black-ink) dark:text-white/90 mb-3 opacity-90">
            PAYMENT ELEVATED
          </p>
          <h2 className="text-4xl sm:text-5xl md:text-5xl lg:text-6xl font-bold text-(--color-off-black-ink) dark:text-white leading-[1.05] tracking-tight max-w-sm">
            Make your payment safe
          </h2>
        </div>
      </div>

      {/* Right Panel (Workspace) */}
      <div className="w-full md:w-3/5 bg-(--color-pure-white) dark:bg-(--color-obsidian) relative flex items-center justify-center p-6 sm:p-10 md:p-12 min-h-screen transition-colors duration-300">
        {/* Theme Toggle (Top Right) */}
        <div className="absolute top-6 right-6 md:top-8 md:right-8">
          <ThemeToggle isDark={isDark} setIsDark={toggleTheme} />
        </div>

        {/* Auth Card */}
        <div className="w-full max-w-md bg-(--color-off-white-canvas) dark:bg-(--color-graphite-dark) rounded-3xl p-8 sm:p-10 md:p-12 shadow-sm border border-(--color-ash)/40 dark:border-(--color-steel) my-auto transition-colors duration-300">
          <AnimatePresence mode="wait">
            <motion.div
              key={isLogin ? 'login' : 'signup'}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="w-full"
            >
              {/* Header */}
              <div className="mb-6">
                <h2 className="text-(length:--text-heading) font-semibold text-(--color-off-black-ink) dark:text-(--color-cloud) tracking-tight">
                  {isLogin ? 'Welcome back' : 'Create Account'}
                </h2>
                <p className="text-(length:--text-body-sm) text-(--color-graphite) dark:text-(--color-ash-dark) mt-1">
                  {isLogin ? 'Sign in to your account' : 'Sign up for a secure user account'}
                </p>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                {!isLogin && (
                  <div>
                    <label 
                      htmlFor="fullName" 
                      className="block text-(length:--text-caption) font-semibold text-(--color-off-black-ink) dark:text-(--color-cloud) mb-1.5"
                    >
                      Full Name
                    </label>
                    <input
                      id="fullName"
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Rohit Kumar"
                      className="w-full bg-(--color-pure-white) dark:bg-(--color-abyss) border border-(--color-ash) dark:border-(--color-steel) rounded-md px-3.5 py-2.5 text-(length:--text-body-sm) text-(--color-off-black-ink) dark:text-(--color-cloud) placeholder-(--color-graphite)/60 dark:placeholder-(--color-ash-dark)/60 focus:outline-none focus:border-(--color-off-black-ink) dark:focus:border-(--color-iris-gleam) transition-colors"
                    />
                  </div>
                )}

                {/* Email Input */}
                <div>
                  <label 
                    htmlFor="email" 
                    className="block text-(length:--text-caption) font-semibold text-(--color-off-black-ink) dark:text-(--color-cloud) mb-1.5"
                  >
                    Email address
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@domain.com"
                    className="w-full bg-(--color-pure-white) dark:bg-(--color-abyss) border border-(--color-ash) dark:border-(--color-steel) rounded-md px-3.5 py-2.5 text-(length:--text-body-sm) text-(--color-off-black-ink) dark:text-(--color-cloud) placeholder-(--color-graphite)/60 dark:placeholder-(--color-ash-dark)/60 focus:outline-none focus:border-(--color-off-black-ink) dark:focus:border-(--color-iris-gleam) transition-colors"
                  />
                </div>

                {/* Password Input */}
                <div>
                  <label 
                    htmlFor="password" 
                    className="block text-(length:--text-caption) font-semibold text-(--color-off-black-ink) dark:text-(--color-cloud) mb-1.5"
                  >
                    Password
                  </label>
                  <div className="relative flex items-center">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="............"
                      className="w-full bg-(--color-pure-white) dark:bg-(--color-abyss) border border-(--color-ash) dark:border-(--color-steel) rounded-md pl-3.5 pr-10 py-2.5 text-(length:--text-body-sm) text-(--color-off-black-ink) dark:text-(--color-cloud) placeholder-(--color-graphite)/60 dark:placeholder-(--color-ash-dark)/60 focus:outline-none focus:border-(--color-off-black-ink) dark:focus:border-(--color-iris-gleam) transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-(--color-graphite) dark:text-(--color-ash-dark) hover:text-(--color-off-black-ink) dark:hover:text-white transition-colors cursor-pointer p-1"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? (
                        <Eye className="w-4 h-4 shrink-0" />
                      ) : (
                        <EyeOff className="w-4 h-4 shrink-0" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Primary Action Button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-(--color-electric-lime) dark:bg-(--color-iris-gleam) text-(--color-off-black-ink) dark:text-white font-bold text-(length:--text-body-sm) py-3 rounded-(--radius-full) hover:opacity-90 active:scale-[0.99] transition-all cursor-pointer shadow-sm mt-6 disabled:opacity-50"
                >
                  {loading ? 'Processing...' : isLogin ? 'Sign in' : 'Sign up'}
                </button>
              </form>

              {/* Divider */}
              <div className="flex items-center my-5">
                <div className="flex-1 border-t border-(--color-ash)/60 dark:border-(--color-steel)/60" />
                <span className="px-3 text-xs font-bold uppercase tracking-wider text-(--color-graphite) dark:text-(--color-ash-dark)">
                  OR
                </span>
                <div className="flex-1 border-t border-(--color-ash)/60 dark:border-(--color-steel)/60" />
              </div>

              {/* Google Sign In Container */}
              <div className="flex flex-col items-center justify-center gap-2">
                <div ref={googleBtnRef} className="w-full flex justify-center min-h-[44px]"></div>
                {(!GOOGLE_CLIENT_ID || !window.google?.accounts?.id) && (
                  <button
                    type="button"
                    onClick={handleCustomGoogleClick}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-3 bg-(--color-pure-white) dark:bg-(--color-abyss) border border-(--color-ash) dark:border-(--color-steel) rounded-(--radius-full) py-2.5 px-4 text-(length:--text-body-sm) font-semibold text-(--color-off-black-ink) dark:text-(--color-cloud) hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.99] transition-all cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                    <span>{isLogin ? 'Sign in with Google' : 'Sign up with Google'}</span>
                  </button>
                )}
              </div>

              {/* Footer Toggle */}
              <div className="text-center mt-6 text-(length:--text-caption) text-(--color-graphite) dark:text-(--color-ash-dark)">
                <span>
                  {isLogin ? "Don't have an account? " : "Already have an account? "}
                </span>
                <button
                  type="button"
                  onClick={() => setIsLogin(!isLogin)}
                  className="font-bold underline text-(--color-off-black-ink) dark:text-(--color-cloud) cursor-pointer hover:opacity-80 transition-opacity ml-0.5"
                >
                  {isLogin ? 'Sign up' : 'Sign in'}
                </button>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export default AuthScreen;