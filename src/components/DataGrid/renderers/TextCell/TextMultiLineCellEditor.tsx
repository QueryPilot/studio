import React from "react";
import type { TextMultiLineCustomCell } from "./types";
import { TextCellEditor, type TextCellEditorProps } from "./TextCellEditor";

export const TextMultiLineCellEditor: React.FC<
  TextCellEditorProps<TextMultiLineCustomCell>
> = (props) => <TextCellEditor {...props} />;

export const TextMultiLineCellEditorWithProps = Object.assign(
  TextMultiLineCellEditor,
  {
    disablePadding: true,
    disableStyling: false,
  },
);
