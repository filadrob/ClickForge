import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { LogIn, UserPlus, Loader2, ArrowLeft, Mail } from "lucide-react";

export default function AuthPage() {
  const { user, isLoading: authLoading, needsPasswordReset } = useAuth();
  const [, setLocation] = useLocation();

  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Redirect to studio if already signed in (or to reset-password if recovery)
  useEffect(() => {
    if (!authLoading && user) {
      if (needsPasswordReset) {
        setLocation("/reset-password");
      } else {
        setLocation("/studio");
      }
    }
  }, [user, authLoading, needsPasswordReset, setLocation]);

  if (authLoading) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        toast.success("Welcome back!");
        setLocation("/studio");
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        
        if (data.user && data.user.identities && data.user.identities.length === 0) {
          toast.error("This email is already registered. Please sign in.");
          setMode("login");
        } else if (!data.session) {
          toast.success("Success! Please check your email for a confirmation link.");
        } else {
          toast.success("Account created successfully!");
          setLocation("/studio");
        }
      }
    } catch (error: any) {
      toast.error(error.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success("Check your email for a password reset link.");
    } catch (error: any) {
      toast.error(error.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/studio`,
        }
      });
      if (error) throw error;
    } catch (error: any) {
      toast.error(error.message || "An error occurred with Google Sign In");
    }
  };

  // ── Forgot password form ──────────────────────────────────────────────
  if (mode === "forgot") {
    return (
      <div
        className="flex min-h-[100dvh] items-center justify-center px-4"
        style={{
          background:
            "linear-gradient(135deg, hsl(248,90%,97%) 0%, hsl(240,15%,94%) 100%)",
        }}
      >
        <div className="w-full max-w-[440px]">
          <div className="flex justify-center mb-6">
            <img src="/logo.svg" alt="ClickForge" className="h-10 w-10" />
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="mb-6 text-center">
              <h1 className="text-2xl font-bold text-slate-900">
                Reset your password
              </h1>
              <p className="text-slate-500 mt-2 text-sm">
                Enter your email and we'll send you a link to set a new password.
              </p>
            </div>

            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-email">Email address</Label>
                <Input
                  id="reset-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <Button type="submit" className="w-full bg-[#5f5ce6] hover:bg-[#4b48cc]" disabled={loading}>
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="mr-2 h-4 w-4" />
                )}
                Send reset link
              </Button>
            </form>

            <div className="mt-6 text-center text-sm">
              <button
                type="button"
                className="inline-flex items-center gap-1 font-medium text-[#5f5ce6] hover:text-[#4b48cc] hover:underline"
                onClick={() => setMode("login")}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to sign in
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Sign in / Sign up form ────────────────────────────────────────────
  return (
    <div
      className="flex min-h-[100dvh] items-center justify-center px-4"
      style={{
        background:
          "linear-gradient(135deg, hsl(248,90%,97%) 0%, hsl(240,15%,94%) 100%)",
      }}
    >
      <div className="w-full max-w-[440px]">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <img src="/logo.svg" alt="ClickForge" className="h-10 w-10" />
        </div>

        {/* Auth form */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-slate-900">
              {mode === "login" ? "Welcome back" : "Create an account"}
            </h1>
            <p className="text-slate-500 mt-2 text-sm">
              {mode === "login"
                ? "Enter your credentials to access your account"
                : "Sign up to start creating your projects"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                {mode === "login" && (
                  <button
                    type="button"
                    className="text-xs font-medium text-[#5f5ce6] hover:text-[#4b48cc] hover:underline"
                    onClick={() => setMode("forgot")}
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>

            <Button type="submit" className="w-full bg-[#5f5ce6] hover:bg-[#4b48cc]" disabled={loading}>
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : mode === "login" ? (
                <LogIn className="mr-2 h-4 w-4" />
              ) : (
                <UserPlus className="mr-2 h-4 w-4" />
              )}
              {mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white px-2 text-slate-500">Or continue with</span>
              </div>
            </div>

            <div className="mt-6">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleGoogleSignIn}
              >
                <svg className="mr-2 h-4 w-4" aria-hidden="true" focusable="false" data-prefix="fab" data-icon="google" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512">
                  <path fill="currentColor" d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"></path>
                </svg>
                Google
              </Button>
            </div>
          </div>

          <div className="mt-6 text-center text-sm">
            <span className="text-slate-500">
              {mode === "login" ? "Don't have an account? " : "Already have an account? "}
            </span>
            <button
              type="button"
              className="font-medium text-[#5f5ce6] hover:text-[#4b48cc] hover:underline"
              onClick={() => setMode(mode === "login" ? "signup" : "login")}
            >
              {mode === "login" ? "Sign up" : "Sign in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

