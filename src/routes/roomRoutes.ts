import { Router } from 'express';
import { createRoom, getRoomByCode } from '../controllers/roomController';

const roomRouter = Router();

roomRouter.post('/', createRoom);
roomRouter.get('/', getRoomByCode);

export default roomRouter;
