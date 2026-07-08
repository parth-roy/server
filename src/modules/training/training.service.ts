import { prisma } from "@shared/db/prisma";
import { CourseLevel, CourseStatus } from "@prisma/client";

export class TrainingService {
  // ── Admin Functions ────────────────────────────────────────────────────────

  async getAdminCourses() {
    // Return all courses + completion count stats
    const courses = await prisma.trainingCourse.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            workerProgress: {
              where: { status: "COMPLETED" },
            },
          },
        },
      },
    });

    return courses.map((c) => ({
      ...c,
      completions: c._count.workerProgress,
    }));
  }

  async getAdminStats() {
    const totalCourses = await prisma.trainingCourse.count({ where: { isActive: true } });
    const totalCompletions = await prisma.workerTrainingProgress.count({ where: { status: "COMPLETED" } });
    
    // Most completed courses
    const topCourses = await prisma.trainingCourse.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { workerProgress: { where: { status: "COMPLETED" } } } }
      },
      orderBy: { workerProgress: { _count: "desc" } },
      take: 5,
    });

    return {
      totalCourses,
      totalCompletions,
      topCompleted: topCourses.map(c => ({ id: c.id, title: c.title, completions: c._count.workerProgress }))
    };
  }

  async createCourse(data: {
    title: string;
    description: string;
    modulesCount: number;
    durationMinutes: number;
    level: CourseLevel;
    icon: string;
    iconColor: string;
    iconBgColor: string;
  }) {
    return prisma.trainingCourse.create({ data });
  }

  async updateCourse(id: string, data: any) {
    return prisma.trainingCourse.update({ where: { id }, data });
  }

  async deleteCourse(id: string) {
    return prisma.trainingCourse.update({ where: { id }, data: { isActive: false } });
  }

  // ── Workforce Functions ────────────────────────────────────────────────────

  async getWorkforceCourses(workerId: string) {
    // Fetch all active courses and left join progress
    const courses = await prisma.trainingCourse.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
    });

    const progress = await prisma.workerTrainingProgress.findMany({
      where: { workerId },
    });

    const progressMap = new Map(progress.map((p) => [p.courseId, p]));

    return courses.map((course) => {
      const p = progressMap.get(course.id);
      return {
        ...course,
        progress: p
          ? {
              status: p.status,
              completedModules: p.completedModules,
              lastAccessed: p.lastAccessed,
              certificateUrl: p.certificateUrl,
            }
          : {
              status: "NOT_STARTED",
              completedModules: 0,
              lastAccessed: null,
              certificateUrl: null,
            },
      };
    });
  }

  async updateProgress(workerId: string, courseId: string) {
    // Get the course
    const course = await prisma.trainingCourse.findUnique({ where: { id: courseId } });
    if (!course) throw new Error("Course not found");

    // Get current progress or create
    let progress = await prisma.workerTrainingProgress.findUnique({
      where: { workerId_courseId: { workerId, courseId } },
    });

    if (!progress) {
      progress = await prisma.workerTrainingProgress.create({
        data: {
          workerId,
          courseId,
          status: "IN_PROGRESS",
          completedModules: 0,
        },
      });
    }

    if (progress.status === "COMPLETED") {
      return progress; // Already complete
    }

    // Increment completed modules
    const newCompleted = Math.min(progress.completedModules + 1, course.modulesCount);
    const newStatus = newCompleted === course.modulesCount ? "COMPLETED" : "IN_PROGRESS";
    
    // Fake Certificate generator (Requested by user: standard image with Parther Technologies)
    const certificateUrl = newStatus === "COMPLETED" ? "https://gomytruck.sgp1.digitaloceanspaces.com/assets/parther_standard_certificate.png" : null;

    return prisma.workerTrainingProgress.update({
      where: { id: progress.id },
      data: {
        completedModules: newCompleted,
        status: newStatus,
        lastAccessed: new Date(),
        ...(certificateUrl && { certificateUrl }),
      },
    });
  }
}

export const trainingService = new TrainingService();
