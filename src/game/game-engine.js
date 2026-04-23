import {Game} from "../models/game.js";
import { gameStore } from "./state/game-store.js";
export class GameEngine{
    constructor(){
        this.gameStore = gameStore;
    }
    
    viewAllGames(){
        console.log("hoola");
        for (const g of gameStore.getAll()) {
            console.log(`Procesando partida: ${g.id}`);
        }
    }
}
// Exportamos el motor del juego para poder usarlo desde el index
export const gameEngine = new GameEngine();