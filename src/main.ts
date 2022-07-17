import {
  BabySubType,
  ButtonAction,
  CollectiblePedestalType,
  CollectibleType,
  EntityType,
  ItemType,
  ModCallback,
  PickupVariant,
  PlayerVariant,
  RoomType,
} from "isaac-typescript-definitions";
import {
  CollectibleIndex,
  DefaultMap,
  game,
  getCollectibleIndex,
  getCollectiblePedestalType,
  getPlayerIndex,
  getPlayers,
  isBlindCollectible,
  isPassiveCollectible,
  log,
  ModCallbackCustom,
  PickingUpItem,
  PlayerIndex,
  saveDataManager,
  upgradeMod,
} from "isaacscript-common";

const MOD_NAME = "Less talking. More gaming.";
const DEBUG = false;

const state = {
  run: {
    itemCounts: new DefaultMap<PlayerIndex, DefaultMap<string, number>>(() => new DefaultMap<string, number>(0)),
    itemPlayerPriorities: new DefaultMap<PlayerIndex, DefaultMap<string, number>>(() => new DefaultMap<string, number>(() => Math.random())),
  },
  room: {
    itemGroups: new Map<CollectibleType, string>(),
    offerItems: new DefaultMap<PlayerIndex, boolean>(false),
    hiddenItems: new DefaultMap<CollectibleIndex, boolean, [arg: EntityPickupCollectible]>((pedestal) => isBlindCollectible(pedestal)),
  },
};

main();

function mapToString<K, V>(map: Map<K, V>) {
  const res: string[] = [];
  for (const [key, value] of map.entries()) {
    res.push(`${key}: ${value}`);
  }
  return res.join(", ");
}

function main() {
  const modVanilla = RegisterMod(MOD_NAME, 1);
  const mod = upgradeMod(modVanilla);

  saveDataManager("main", state);

  mod.AddCallback(ModCallback.POST_RENDER, postRender);
  mod.AddCallback(ModCallback.PRE_PICKUP_COLLISION, prePickupCollision);
  mod.AddCallbackCustom(ModCallbackCustom.PRE_ITEM_PICKUP, preItemPickup);
  mod.AddCallback(ModCallback.EXECUTE_CMD, executeCmd);

  log(`${MOD_NAME} initialized.`);
}

function executeCmd(command: string, parameters: string, _player: EntityPlayer) {
  if (command === "ltmg") {
    if (parameters === "itemCounts") {
      for (const [playerIndex, itemCounts] of state.run.itemCounts.entries()) {
        logMsg(`- player ${playerIndex}:`);
        logMsg(mapToString(itemCounts));
      }
    } else if (parameters === "itemPlayerPriorities") {
      for (const [playerIndex, itemPlayerPriorities] of state.run.itemPlayerPriorities.entries()) {
        logMsg(`- player ${playerIndex}:`);
        logMsg(mapToString(itemPlayerPriorities));
      }
    } else if (parameters === "itemGroups") {
      logMsg(mapToString(state.room.itemGroups));
    } else {
      logMsg("wrong parameter");
    }
  }
}

function preItemPickup(player: EntityPlayer, pickingUpItem: PickingUpItem) {
  if ([ItemType.PASSIVE, ItemType.FAMILIAR].includes(pickingUpItem.itemType)) {
    logMsg(`player ${player.Index}-${getPlayerIndex(player)} picked up ${pickingUpItem.itemType} ${pickingUpItem.subType}`);
    const type = pickingUpItem.subType as CollectibleType;
    newItemFound(player, type);
  }
}

function postRender() {
  updateOfferItems();

  Isaac.FindByType(EntityType.PICKUP, PickupVariant.COLLECTIBLE).forEach((entity) => {
    const pedestal = entity.ToPickup() as EntityPickupCollectible;

    if (isCollectibleInteresting(pedestal)) {
      state.room.itemGroups.set(pedestal.SubType, getCollectibleGroup(pedestal));

      if (getSafePlayers().length > 1) {
        addTextInfoCollectible(pedestal);
      }
    }
  });
}

function updateOfferItems() {
  getSafePlayers().forEach((player) => {
    if (
      [ButtonAction.SHOOT_LEFT, ButtonAction.SHOOT_RIGHT, ButtonAction.SHOOT_UP, ButtonAction.SHOOT_DOWN].every((action) =>
        Input.IsActionPressed(action, player.ControllerIndex),
      )
    ) {
      if (!state.room.offerItems.getAndSetDefault(getPlayerIndex(player))) {
        player.AnimateHappy();
      }
      state.room.offerItems.set(getPlayerIndex(player), true);
    }
  });
}

function addTextInfoCollectible(pedestal: EntityPickupCollectible) {
  const index = getCollectibleIndex(pedestal);
  if (state.room.hiddenItems.getAndSetDefault(index, pedestal)) {
    return;
  }

  const group = getCollectibleGroup(pedestal);

  const pos = game.GetRoom().WorldToScreenPosition(pedestal.Position);
  let xOffset = 0;

  Isaac.RenderText(`${group}`, pos.X, pos.Y, 0, 1, 1, 1);

  const allPlayerCounts = getSortedPlayers(pedestal);

  const first = allPlayerCounts[0];
  if (first !== undefined) {
    allPlayerCounts.sort(([playerA, _countA], [playerB, _countB]) => playerA.Index - playerB.Index);
    allPlayerCounts.forEach(([player, _count]) => {
      const available = player === first[0] || state.room.offerItems.getAndSetDefault(getPlayerIndex(first[0]));
      Isaac.RenderText(`J${player.Index + 1}`, pos.X + xOffset++ * 16, pos.Y + 12, available ? 0 : 1, available ? 1 : 0, 0, 1);
    });
  }
}

function prePickupCollision(pickup: EntityPickup, collider: Entity, _low: boolean): boolean | undefined {
  if (pickup.Type === EntityType.PICKUP && pickup.Variant === PickupVariant.COLLECTIBLE && collider.Type === EntityType.PLAYER) {
    const player = collider.ToPlayer();
    const pedestal = pickup as EntityPickupCollectible;
    if (isCollectibleInteresting(pedestal) && player !== undefined && isSafePlayer(player)) {
      const first = getSortedPlayers(pedestal)[0];
      if (first !== undefined) {
        if (getPlayerIndex(player) !== getPlayerIndex(first[0]) && !state.room.offerItems.getAndSetDefault(getPlayerIndex(first[0]))) {
          if (player.IsExtraAnimationFinished()) {
            player.AnimateSad();
          }
          return false;
        }
      }
    }
  }

  return undefined;
}

function isSafePlayer(player: EntityPlayer) {
  return (
    player.Type === EntityType.PLAYER &&
    player.Variant === PlayerVariant.PLAYER &&
    !player.IsDead() &&
    player.GetMainTwin().Index === player.Index &&
    player.GetBabySkin() === BabySubType.UNASSIGNED &&
    !player.IsCoopGhost()
  );
}

function getSafePlayers() {
  return getPlayers().filter((player) => isSafePlayer(player));
}

function getSortedPlayers(collectible: EntityPickupCollectible) {
  const group = getCollectibleGroup(collectible);

  const allPlayerCounts: Array<[EntityPlayer, number]> = [];

  getSafePlayers().forEach((player) => {
    const playerIndex = getPlayerIndex(player);
    const count = state.run.itemCounts.getAndSetDefault(playerIndex).getAndSetDefault(group);

    allPlayerCounts.push([player, count]);
  });

  allPlayerCounts.sort(([playerA, countA], [playerB, countB]) => {
    if (countA !== countB) {
      return countA - countB;
    }

    return (
      state.run.itemPlayerPriorities.getAndSetDefault(getPlayerIndex(playerA)).getAndSetDefault(group) -
      state.run.itemPlayerPriorities.getAndSetDefault(getPlayerIndex(playerB)).getAndSetDefault(group)
    );
  });

  return allPlayerCounts;
}

function isCollectibleInteresting(collectible: EntityPickupCollectible) {
  return collectible.SubType !== CollectibleType.NULL && isPassiveCollectible(collectible.SubType) && collectible.Price >= 0;
}

function getCollectibleGroup(collectible: EntityPickupCollectible): string {
  let pedestalType = getCollectiblePedestalType(collectible);
  let roomType = game.GetRoom().GetType();

  if ([CollectiblePedestalType.LOCKED_CHEST, CollectiblePedestalType.ETERNAL_CHEST, CollectiblePedestalType.BOMB_CHEST].includes(pedestalType)) {
    pedestalType = CollectiblePedestalType.LOCKED_CHEST;
  }
  if (pedestalType === CollectiblePedestalType.MEGA_CHEST) {
    roomType = RoomType.TREASURE;
  }
  if (
    [
      CollectiblePedestalType.LOCKED_CHEST,
      CollectiblePedestalType.WOODEN_CHEST,
      CollectiblePedestalType.OLD_CHEST,
      CollectiblePedestalType.MOMS_CHEST,
      CollectiblePedestalType.MOMS_DRESSING_TABLE,
      CollectiblePedestalType.RED_CHEST,
      CollectiblePedestalType.SLOT_MACHINE,
      CollectiblePedestalType.BLOOD_DONATION_MACHINE,
      CollectiblePedestalType.FORTUNE_TELLING_MACHINE,
    ].includes(pedestalType)
  ) {
    return CollectiblePedestalType[pedestalType] ?? "unknown pedestal";
  }

  if ([RoomType.SHOP, RoomType.BLACK_MARKET].includes(roomType)) {
    roomType = RoomType.SHOP;
  }
  if ([RoomType.TREASURE, RoomType.DUNGEON, RoomType.CHALLENGE, RoomType.BOSS_RUSH].includes(roomType)) {
    roomType = RoomType.TREASURE;
  }
  if ([RoomType.ANGEL, RoomType.SACRIFICE].includes(roomType)) {
    roomType = RoomType.ANGEL;
  }
  if (
    [
      RoomType.SHOP,
      RoomType.ERROR,
      RoomType.BOSS,
      RoomType.MINI_BOSS,
      RoomType.SECRET,
      RoomType.CURSE,
      RoomType.TREASURE,
      RoomType.ANGEL,
      RoomType.LIBRARY,
      RoomType.DEVIL,
      RoomType.PLANETARIUM,
      RoomType.ULTRA_SECRET,
    ].includes(roomType)
  ) {
    return RoomType[roomType] ?? "unknown room";
  }

  return "DEFAULT";
}

function newItemFound(player: EntityPlayer, collectible: CollectibleType) {
  if (isSafePlayer(player)) {
    logMsg("known item groups:");
    for (const [collectibleType, collectibleGroup] of state.room.itemGroups.entries()) {
      logMsg(`${collectibleType}: ${collectibleGroup}`);
    }
    const group = state.room.itemGroups.get(collectible);
    logMsg(`item is of group ${group}`);
    if (group !== undefined) {
      const playerIndex = getPlayerIndex(player);
      const previousCount = state.run.itemCounts.getAndSetDefault(playerIndex).getAndSetDefault(group);
      state.run.itemCounts.getAndSetDefault(playerIndex).set(group, previousCount + 1);
      logMsg(`${collectible} incremented ${group} to ${previousCount + 1} for player ${player.Index}-${playerIndex}`);
    }
  }
}

function logMsg(msg: string, toConsole = true) {
  Isaac.DebugString(msg);
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (DEBUG && toConsole) {
    print(msg);
  }
}
