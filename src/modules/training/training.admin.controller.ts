import { Request, Response } from "express";
import { trainingService } from "./training.service";
import { CourseLevel } from "@prisma/client";

export class TrainingAdminController {
  async getCourses(req: Request, res: Response) {
    try {
      const courses = await trainingService.getAdminCourses();
      res.json({ success: true, data: courses });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getStats(req: Request, res: Response) {
    try {
      const stats = await trainingService.getAdminStats();
      res.json({ success: true, data: stats });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async createCourse(req: Request, res: Response) {
    try {
      const data = req.body;
      const course = await trainingService.createCourse({
        title: data.title,
        description: data.description,
        modulesCount: Number(data.modulesCount),
        durationMinutes: Number(data.durationMinutes),
        level: data.level as CourseLevel,
        icon: data.icon,
        iconColor: data.iconColor,
        iconBgColor: data.iconBgColor,
      });
      res.json({ success: true, data: course });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async updateCourse(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      const data = req.body;
      const course = await trainingService.updateCourse(id, data);
      res.json({ success: true, data: course });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async deleteCourse(req: Request, res: Response) {
    try {
      const id = req.params.id as string;
      await trainingService.deleteCourse(id);
      res.json({ success: true, message: "Course deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

export const trainingAdminController = new TrainingAdminController();
