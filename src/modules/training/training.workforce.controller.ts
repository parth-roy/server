import { Request, Response } from "express";
import { trainingService } from "./training.service";

export class TrainingWorkforceController {
  async getCourses(req: Request, res: Response) {
    try {
      const workerId = (req as any).user.workerId; // Assuming workforce auth attaches workerId
      if (!workerId) {
         return res.status(403).json({ success: false, message: "Worker ID not found in token" });
      }

      const courses = await trainingService.getWorkforceCourses(workerId);
      res.json({ success: true, data: courses });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async updateProgress(req: Request, res: Response) {
    try {
      const workerId = (req as any).user.workerId;
      if (!workerId) {
         return res.status(403).json({ success: false, message: "Worker ID not found in token" });
      }

      const id = req.params.id as string;
      const progress = await trainingService.updateProgress(workerId, id);
      res.json({ success: true, data: progress });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

export const trainingWorkforceController = new TrainingWorkforceController();
