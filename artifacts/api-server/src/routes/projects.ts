import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { projectsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  CreateProjectBody,
  UpdateProjectBody,
  GetProjectParams,
  UpdateProjectParams,
  DeleteProjectParams,
} from "@workspace/api-zod";

const router = Router();

const requireAuth = (req: any, res: any, next: any) => {
  const auth = getAuth(req);
  const userId = auth?.sessionClaims?.userId || auth?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.userId = userId;
  next();
};

function toApiProject(p: typeof projectsTable.$inferSelect) {
  return {
    id: p.id,
    userId: p.userId,
    name: p.name,
    svgData: p.svgData,
    extrudeDepth: p.extrudeDepth,
    keycapSize: p.keycapSize,
    pegRadius: p.pegRadius,
    settings: p.settings ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

router.get("/projects", requireAuth, async (req: any, res: any) => {
  try {
    const projects = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.userId, req.userId))
      .orderBy(desc(projectsTable.updatedAt));
    res.json(projects.map(toApiProject));
  } catch (err) {
    req.log.error({ err }, "Failed to list projects");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/projects", requireAuth, async (req: any, res: any) => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error });
  }
  try {
    const { name, svgData, extrudeDepth = 4, keycapSize = 14, pegRadius = 3.5, settings } = parsed.data;
    const [project] = await db
      .insert(projectsTable)
      .values({
        userId: req.userId,
        name,
        svgData,
        extrudeDepth,
        keycapSize,
        pegRadius,
        settings: settings ?? null,
      })
      .returning();
    res.status(201).json(toApiProject(project));
  } catch (err) {
    req.log.error({ err }, "Failed to create project");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/projects/stats", requireAuth, async (req: any, res: any) => {
  try {
    const projects = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.userId, req.userId))
      .orderBy(desc(projectsTable.updatedAt));

    const totalExports = projects.reduce((sum, p) => sum + (p.exportCount || 0), 0);
    const mostRecentProject = projects.length > 0 ? toApiProject(projects[0]) : null;

    res.json({
      totalProjects: projects.length,
      totalExports,
      mostRecentProject,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get project stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/projects/:id", requireAuth, async (req: any, res: any) => {
  const parsed = GetProjectParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid id" });
  }
  try {
    const [project] = await db
      .select()
      .from(projectsTable)
      .where(and(eq(projectsTable.id, parsed.data.id), eq(projectsTable.userId, req.userId)));
    if (!project) return res.status(404).json({ error: "Not found" });
    res.json(toApiProject(project));
  } catch (err) {
    req.log.error({ err }, "Failed to get project");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/projects/:id", requireAuth, async (req: any, res: any) => {
  const paramParsed = UpdateProjectParams.safeParse({ id: Number(req.params.id) });
  if (!paramParsed.success) {
    return res.status(400).json({ error: "Invalid id" });
  }
  const bodyParsed = UpdateProjectBody.safeParse(req.body);
  if (!bodyParsed.success) {
    return res.status(400).json({ error: bodyParsed.error });
  }
  try {
    const updates: Partial<typeof projectsTable.$inferInsert> = {
      ...bodyParsed.data,
      updatedAt: new Date(),
    };
    const [project] = await db
      .update(projectsTable)
      .set(updates)
      .where(and(eq(projectsTable.id, paramParsed.data.id), eq(projectsTable.userId, req.userId)))
      .returning();
    if (!project) return res.status(404).json({ error: "Not found" });
    res.json(toApiProject(project));
  } catch (err) {
    req.log.error({ err }, "Failed to update project");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/projects/:id", requireAuth, async (req: any, res: any) => {
  const parsed = DeleteProjectParams.safeParse({ id: Number(req.params.id) });
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid id" });
  }
  try {
    const [deleted] = await db
      .delete(projectsTable)
      .where(and(eq(projectsTable.id, parsed.data.id), eq(projectsTable.userId, req.userId)))
      .returning();
    if (!deleted) return res.status(404).json({ error: "Not found" });
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Failed to delete project");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
