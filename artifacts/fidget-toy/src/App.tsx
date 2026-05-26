import { lazy, Suspense } from "react";
import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { AuthProvider, useAuth } from "./lib/auth";
import { Toaster } from "@/components/ui/sonner";
import Home from "@/pages/Home";
import AuthPage from "@/pages/Auth";

// Heavy / rarely-used routes are code-split so the first paint of the marketing
// home page doesn't pay the cost of pulling in three.js,
// the geometry builders, or the project / library list views.
const Studio = lazy(() => import("@/pages/Studio"));
const Projects = lazy(() => import("@/pages/Projects"));
const Library = lazy(() => import("@/pages/Library"));
const ResetPassword = lazy(() => import("@/pages/ResetPassword"));
const NotFound = lazy(() => import("@/pages/not-found"));
// Dev-only jig geometry test page — never included in production bundle
const JigTestPage = import.meta.env.DEV
  ? lazy(() => import("@/pages/jig-test"))
  : null;

function HomeRedirect() {
  const { user, isLoading } = useAuth();

  if (isLoading) return null;

  return user ? <Redirect to="/studio" /> : <Home />;
}

/**
 * Studio is open to anonymous "try it now" guests. We render it
 * unconditionally so the page does not flash a redirect while auth
 * boots — gating for guest-only restrictions happens inside Studio.
 */
function PublicStudio() {
  return <Studio />;
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();

  if (isLoading) return null;

  return user ? <Component /> : <Redirect to="/sign-in" />;
}

function AppRoutes() {
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense
        fallback={
          <div className="fixed inset-0 grid place-items-center pointer-events-none">
            <div
              className="h-8 w-8 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin opacity-70"
              role="status"
              aria-label="Loading"
            />
          </div>
        }
      >
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in" component={AuthPage} />
          <Route path="/sign-up" component={AuthPage} />
          <Route path="/reset-password" component={ResetPassword} />
          <Route path="/studio" component={PublicStudio} />
          <Route path="/studio/:id" component={() => <ProtectedRoute component={Studio} />} />
          <Route path="/projects" component={() => <ProtectedRoute component={Projects} />} />
          <Route path="/library" component={() => <ProtectedRoute component={Library} />} />
          {/* Dev-only jig geometry verification page */}
          {import.meta.env.DEV && JigTestPage && (
            <Route path="/jig-test" component={JigTestPage} />
          )}
          <Route component={NotFound} />
        </Switch>
      </Suspense>
      <Toaster />
    </QueryClientProvider>
  );
}

function App() {
  return (
    <AuthProvider>
      <WouterRouter>
        <AppRoutes />
      </WouterRouter>
    </AuthProvider>
  );
}

export default App;
