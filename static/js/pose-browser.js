// Cadangan: MediaPipe Pose Landmarker versi web, berjalan di browser tanpa server
import { CFG } from './config.js';

const VER = '0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export class BrowserPose {
  constructor() { this.landmarker = null; this.lastVideoTime = -1; }

  async init() {
    const { PoseLandmarker, FilesetResolver } = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}`);
    const fileset = await FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VER}/wasm`);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO', numPoses: CFG.maxPoses,
      minPoseDetectionConfidence: CFG.minConfidence, minPosePresenceConfidence: CFG.minConfidence, minTrackingConfidence: CFG.minConfidence,
    });
    try { this.landmarker = await PoseLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch (e) { this.landmarker = await PoseLandmarker.createFromOptions(fileset, opts('CPU')); }
  }

  get ready() { return !!this.landmarker; }

  // daftar pose (landmark ternormalisasi), atau null kalau belum ada frame video baru
  detect(video, nowMs) {
    if (!this.landmarker || video.readyState < 2 || video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;
    return this.landmarker.detectForVideo(video, nowMs).landmarks || [];
  }
}
