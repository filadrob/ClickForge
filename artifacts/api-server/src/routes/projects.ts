import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { projectsTable } from "@workspace/db";
import { eq, and, desc, count, sum } from "drizzle-orm";
import {
  CreateProjectBody,
  UpdateProjectBody,
  GetProjectParams,
  UpdateProjectParams,
  DeleteProjectParams,
} from "@workspace/api-zod";
import { tierForSignedInUser, FREE_PROJECT_LIMIT, PREMIUM_PROJECT_LIMIT } from "../lib/tier";

const LIST_PROJECTS_LIMIT = 100;
const SETTINGS_MAX_PROPERTIES = 100;

const router = Router();

function validateSettings(settings: Record<string, unknown> | null | undefined): string | null {
  if (settings != null && Object.keys(settings).length > SETTINGS_MAX_PROPERTIES) {
    return `settings must not exceed ${SETTINGS_MAX_PROPERTIES} properties`;
  }
  return null;
}

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
      .orderBy(desc(projectsTable.updatedAt))
      .limit(LIST_PROJECTS_LIMIT);
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
  const settingsError = validateSettings(parsed.data.settings);
  if (settingsError) {
    return res.status(400).json({ error: settingsError });
  }
  const svgCreate = parsed.data.svgData.trim();
  if (/<script[\s>]/i.test(svgCreate) || /\son[a-z]+\s*=/i.test(svgCreate)) {
    return res.status(400).json({ error: "svgData contains disallowed content" });
  }
  try {
    const tier = tierForSignedInUser();
    const [{ value: existing }] = await db
      .select({ value: count() })
      .from(projectsTable)
      .where(eq(projectsTable.userId, req.userId));
    if (tier === "free" && existing >= FREE_PROJECT_LIMIT) {
      return res.status(403).json({
        error: `Free accounts can save up to ${FREE_PROJECT_LIMIT} projects. Upgrade to Premium for unlimited saves.`,
        code: "PROJECT_LIMIT_REACHED",
        limit: FREE_PROJECT_LIMIT,
      });
    }
    if (existing >= PREMIUM_PROJECT_LIMIT) {
      return res.status(403).json({
        error: `You have reached the maximum of ${PREMIUM_PROJECT_LIMIT} saved projects. Please delete some projects to continue.`,
        code: "PROJECT_LIMIT_REACHED",
        limit: PREMIUM_PROJECT_LIMIT,
      });
    }
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
    const [agg] = await db
      .select({
        totalProjects: count(),
        totalExports: sum(projectsTable.exportCount),
      })
      .from(projectsTable)
      .where(eq(projectsTable.userId, req.userId));

    const [mostRecentRow] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.userId, req.userId))
      .orderBy(desc(projectsTable.updatedAt))
      .limit(1);

    res.json({
      totalProjects: agg?.totalProjects ?? 0,
      totalExports: Number(agg?.totalExports ?? 0),
      mostRecentProject: mostRecentRow ? toApiProject(mostRecentRow) : null,
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
  const settingsError = validateSettings(bodyParsed.data.settings);
  if (settingsError) {
    return res.status(400).json({ error: settingsError });
  }
  if (bodyParsed.data.svgData !== undefined) {
    const svgUpdate = bodyParsed.data.svgData.trim();
    if (/<script[\s>]/i.test(svgUpdate) || /\son[a-z]+\s*=/i.test(svgUpdate)) {
      return res.status(400).json({ error: "svgData contains disallowed content" });
    }
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
