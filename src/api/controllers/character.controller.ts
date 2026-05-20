import { Response } from "express";
import CharacterModel from "../../models/character.model";
import BorderService from "../../services/border.service";
import { AuthenticatedRequest } from "../../types";
import { catalogOptionsFromUser } from "../../utils/catalogRelease";

const CharacterController = {
  async getAllCharacters(req: AuthenticatedRequest, res: Response) {
    try {
      const characters = await CharacterModel.findAllWithVariants(
        catalogOptionsFromUser(req.user)
      );
      return res.status(200).json(characters);
    } catch (error) {
      console.error("Error getting characters:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },

  async getCharacterEligibleBorders(
    req: AuthenticatedRequest,
    res: Response
  ) {
    try {
      const userId = req.user?.user_id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const { characterId } = req.params;
      if (!characterId) {
        return res.status(400).json({ message: "characterId is required" });
      }

      const result = await BorderService.getCharacterEligibleBorders(
        userId,
        characterId
      );
      if (!result.success) {
        const status = result.error === "Character not found" ? 404 : 400;
        return res.status(status).json({ message: result.error });
      }

      return res.status(200).json({ data: result.data });
    } catch (error) {
      console.error("Error getting character eligible borders:", error);
      return res.status(500).json({
        status: "error",
        message: "Internal server error",
      });
    }
  },
};

export default CharacterController;
