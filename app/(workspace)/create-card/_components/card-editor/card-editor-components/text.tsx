'use client'
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EditorElement, useEditor } from '@/lib/editor/editor-provider';
import clsx from 'clsx';
import { Trash } from 'lucide-react';
import React, { useState } from 'react';

type Props = {
  element: EditorElement;
  sectionId: string;
  bubbleId: string;
}

const TextElement = (props: Props) => {
  const { dispatch, state } = useEditor();

  const [mouseIsOver, setMouseIsOver] = useState<boolean>(false);

  const handleDeleteElement = () => {
    dispatch({
      type: 'DELETE_ELEMENT',
      payload: { elementId: props.element.id, sectionId: props.sectionId, bubbleId: props.bubbleId },
    });
  };

  const handleOnClickBody = (e: React.MouseEvent) => {
    e.stopPropagation();
    dispatch({
      type: 'CHANGE_CLICKED_ELEMENT',
      payload: {
        elementDetails: props.element,
        bubbleId: props.bubbleId,
        sectionId: props.sectionId
      },
    });
  };

  const handleTextUpdate = (e: React.FocusEvent<HTMLSpanElement>) => {
    const newText = e.target.innerText;
    if (newText !== props.element.text) {
      dispatch({
        type: 'UPDATE_ELEMENT',
        payload: {
          bubbleId: props.bubbleId,
          sectionId: props.sectionId,
          elementDetails: {
            ...props.element,
            text: newText,
          },
        },
      });
    }
  };

  return (
    <div
      className={clsx('p-[2px] w-full m-[5px] relative text-[16px] transition-all', {
        '!border-blue-500': state.editor.selectedElement.id === props.element.id,
        '!border-solid': state.editor.selectedElement.id === props.element.id,
        'border-dashed border-[1px] border-slate-300': !state.editor.liveMode,
      })}
      onClick={handleOnClickBody}
      onMouseEnter={() => {
        setMouseIsOver(true);
      }}
      onMouseLeave={() => {
        setMouseIsOver(false);
      }}
    >
      {state.editor.selectedElement.id === props.element.id && !state.editor.liveMode && (
        <Badge className="absolute -top-[25px] -left-[10px] rounded-none rounded-t-lg">
          <div className='text-slate-700'>
            <p>{state.editor.selectedElement.type?.toUpperCase()}</p>
          </div>

        </Badge>
      )}
      <span
        className="text-black"
        contentEditable={!state.editor.liveMode}
        onBlur={handleTextUpdate}
        suppressContentEditableWarning={true}
      >
        {props.element.text}
      </span>

      {mouseIsOver && state.editor.selectedElement.id === props.element.id && !state.editor.liveMode && (
        <div className="absolute -top-[28px] -right-[3px]">
          <Button
            className="flex justify-center h-full border rounded-md bg-red-500"
            variant={"outline"}
            onClick={handleDeleteElement}
          >
            <Trash className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
};

export default TextElement;
