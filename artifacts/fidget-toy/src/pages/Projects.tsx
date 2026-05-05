import { Link, useLocation } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  useListProjects,
  useDeleteProject,
  useGetProjectStats,
  getListProjectsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { svgToDataUri } from "@/lib/svgPreview";
import {
  ChevronLeft,
  Plus,
  Trash2,
  Box,
  LogOut,
  FolderOpen,
  TrendingUp,
  Clock,
} from "lucide-react";

export default function Projects() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const projects = useListProjects();
  const stats = useGetProjectStats();
  const deleteProject = useDeleteProject();

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await deleteProject.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      toast({ title: "Project deleted" });
    } catch {
      toast({ title: "Failed to delete project", variant: "destructive" });
    }
  };

  const isLoading = projects.isLoading;
  const projectList = projects.data ?? [];
  const statsData = stats.data;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-3 flex items-center justify-between bg-card">
        <div className="flex items-center gap-3">
          <Link href="/studio">
            <Button variant="ghost" size="sm" data-testid="button-go-studio">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Studio
            </Button>
          </Link>
          <img src="/logo.svg" alt="ClickForge" className="h-6 w-6" />
          <span className="font-bold text-base">My Projects</span>
          <nav className="ml-4 flex items-center gap-1">
            <Link href="/library">
              <Button variant="ghost" size="sm" data-testid="link-library">
                Library
              </Button>
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{user?.emailAddresses[0]?.emailAddress}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => signOut(() => setLocation("/"))}
            data-testid="button-sign-out"
          >
            <LogOut className="h-4 w-4 mr-1" />
            Sign out
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8">
        {/* Stats */}
        {statsData && (
          <div className="grid grid-cols-3 gap-4 mb-8">
            <Card data-testid="stat-total-projects">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wide mb-1">
                  <Box className="h-3.5 w-3.5" />
                  Total Projects
                </div>
                <p className="text-3xl font-bold" data-testid="text-total-projects">{statsData.totalProjects}</p>
              </CardContent>
            </Card>
            <Card data-testid="stat-total-exports">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wide mb-1">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Total Exports
                </div>
                <p className="text-3xl font-bold" data-testid="text-total-exports">{statsData.totalExports}</p>
              </CardContent>
            </Card>
            <Card data-testid="stat-recent-project">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wide mb-1">
                  <Clock className="h-3.5 w-3.5" />
                  Most Recent
                </div>
                <p className="text-sm font-medium truncate" data-testid="text-recent-project">
                  {statsData.mostRecentProject?.name ?? "—"}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Actions bar */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">
            {isLoading ? "Loading..." : `${projectList.length} project${projectList.length !== 1 ? "s" : ""}`}
          </h2>
          <Link href="/studio">
            <Button data-testid="button-new-project">
              <Plus className="h-4 w-4 mr-2" />
              New Project
            </Button>
          </Link>
        </div>

        {/* Project grid */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="pt-6 h-32" />
              </Card>
            ))}
          </div>
        ) : projectList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <FolderOpen className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground font-medium">No projects yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Upload an SVG in the Studio to create your first fidget toy
            </p>
            <Link href="/studio" className="mt-4">
              <Button data-testid="button-go-to-studio">
                <Plus className="h-4 w-4 mr-2" />
                Open Studio
              </Button>
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projectList.map((project) => (
              <Card
                key={project.id}
                className="group hover:border-primary/50 transition-colors"
                data-testid={`card-project-${project.id}`}
              >
                <CardHeader className="pb-2 pt-4 px-4">
                  {/* SVG preview */}
                  <div className="h-28 rounded-md bg-muted/50 flex items-center justify-center mb-2 overflow-hidden border border-border">
                    <img
                      src={svgToDataUri(project.svgData)}
                      alt={project.name}
                      style={{ width: 80, height: 80, objectFit: "contain" }}
                    />
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <p className="font-semibold text-sm truncate" data-testid={`text-project-name-${project.id}`}>
                    {project.name}
                  </p>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    <Badge variant="secondary" className="text-xs" data-testid={`badge-depth-${project.id}`}>
                      {project.extrudeDepth}mm deep
                    </Badge>
                    <Badge variant="outline" className="text-xs" data-testid={`badge-keycap-${project.id}`}>
                      {project.keycapSize}mm key
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2" data-testid={`text-project-date-${project.id}`}>
                    {new Date(project.updatedAt).toLocaleDateString()}
                  </p>
                  <div className="flex gap-2 mt-3">
                    <Link href={`/studio/${project.id}`} className="flex-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full text-xs"
                        data-testid={`button-open-project-${project.id}`}
                      >
                        Open
                      </Button>
                    </Link>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => handleDelete(project.id, project.name)}
                      disabled={deleteProject.isPending}
                      data-testid={`button-delete-project-${project.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
