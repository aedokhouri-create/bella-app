// Status da sincronização automática de calendário.
import { Router } from "express";
import { appleAtivo } from "../appleCalendar.js";

const router = Router();

router.get("/status", (req, res) => {
  res.json({ apple: appleAtivo(), google: false });
});

export default router;
