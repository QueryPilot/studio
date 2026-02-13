import {
  type CollectionDesignerState,
  type CollectionDesignerAction,
  INITIAL_STATE,
} from "./types";

export function collectionDesignerReducer(
  state: CollectionDesignerState,
  action: CollectionDesignerAction,
): CollectionDesignerState {
  switch (action.type) {
    case "SET_FIELD":
      return { ...state, [action.field]: action.value };

    case "SET_SAVING":
      return { ...state, isSaving: action.value };

    // Mutual exclusion: capped disables time series + clustered
    case "TOGGLE_CAPPED":
      return {
        ...state,
        cappedEnabled: action.enabled,
        ...(action.enabled && {
          timeSeriesEnabled: false,
          clusteredEnabled: false,
        }),
      };

    // Mutual exclusion: time series disables capped (NOT clustered)
    case "TOGGLE_TIME_SERIES":
      return {
        ...state,
        timeSeriesEnabled: action.enabled,
        ...(action.enabled && {
          cappedEnabled: false,
        }),
      };

    // Mutual exclusion: clustered disables capped (NOT time series)
    case "TOGGLE_CLUSTERED":
      return {
        ...state,
        clusteredEnabled: action.enabled,
        ...(action.enabled && {
          cappedEnabled: false,
        }),
      };

    // No exclusions
    case "TOGGLE_COLLATION":
      return { ...state, collationEnabled: action.enabled };
    case "TOGGLE_VALIDATION":
      return { ...state, validationEnabled: action.enabled };
    case "TOGGLE_SEED":
      return { ...state, seedEnabled: action.enabled };

    default:
      return state;
  }
}

export { INITIAL_STATE };
