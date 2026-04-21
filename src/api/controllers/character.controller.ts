import { Request, Response } from "express";
import CharacterModel from "../../models/character.model";

const CharacterController = {
  async getAllCharacters(req: Request, res: Response) {
    try {
      const characters = await CharacterModel.findAllWithVariants();
      return res.status(200).json(characters);
    } catch (error) {
      console.error("Error getting characters:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },
};

export default CharacterController;
