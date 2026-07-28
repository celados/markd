import {
  LuTrash2 as Trash2,
  LuX as X,
} from "@/icons/icons.tsrx";
import { useEffect, useRef, useState } from "octane";
import { Tooltip } from "@/components/ui/Tooltip";
import {
  isValidPropertyKey,
  type Property,
  type PropertyType,
  propertyType,
} from "@/lib/frontmatter";
import { PropertyNameMenu } from "./PropertyNameMenu.tsrx";
import { PropertyValueEditor } from "./PropertyValueEditor.tsrx";

function inputValue(value: Property["value"] | undefined): string {
  if (Array.isArray(value)) return value.join("\n");
  if (value === undefined) return "";
  return String(value);
}

function typedValue(type: PropertyType, value: string): Property["value"] {
  if (type === "list") {
    return value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (type === "checkbox") return value === "true";
  if (type === "number" && value.trim() !== "") return Number(value);
  return value;
}

export function PropertyRow({
  property,
  existingKeys,
  focusNonce,
  onSave,
  onRemove,
  onCancel,
}: {
  property?: Property;
  existingKeys: string[];
  focusNonce?: number;
  onSave: (previousKey: string | null, property: Property) => void;
  onRemove: (key: string) => void;
  onCancel?: () => void;
}) {
  const previousKey = property?.key ?? null;
  const [name, setName] = useState(property?.key ?? "");
  const [valueType, setValueType] = useState<PropertyType>(
    property ? propertyType(property.value) : "text",
  );
  const [value, setValue] = useState(inputValue(property?.value));
  const [invalid, setInvalid] = useState(false);
  const [nameMenuOpen, setNameMenuOpen] = useState(false);
  const nameMenuOpenRef = useRef(false);
  const dismissCommittedRef = useRef(false);
  const skipNextRowBlurRef = useRef(false);
  const valueRef = useRef<HTMLElement | null>(null);

  const updateNameMenuOpen = (open: boolean) => {
    // Portal focus leaves this row's DOM subtree, so blur cannot own menu commits.
    if (open) dismissCommittedRef.current = false;
    nameMenuOpenRef.current = open;
    setNameMenuOpen(open);
  };

  useEffect(() => {
    if (focusNonce === undefined) return;
    updateNameMenuOpen(true);
  }, [focusNonce]);

  const cleanName = name.trim();
  const duplicate = existingKeys.some(
    (key) =>
      key !== previousKey &&
      key.toLocaleLowerCase() === cleanName.toLocaleLowerCase(),
  );
  const validName =
    cleanName.length > 0 && isValidPropertyKey(cleanName) && !duplicate;

  const save = (nextType = valueType, nextValue = value) => {
    if (!validName) {
      setInvalid(true);
      return false;
    }
    onSave(previousKey, {
      key: cleanName,
      value: typedValue(nextType, nextValue),
    });
    setInvalid(false);
    return true;
  };

  const selectType = (nextType: PropertyType) => {
    let nextValue = value;
    if (nextType === "text" && valueType === "list") {
      nextValue = value
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
        .join(", ");
    } else if (nextType === "checkbox") {
      nextValue = value === "true" ? "true" : "false";
    } else if (nextType === "number" && !Number.isFinite(Number(value))) {
      nextValue = "";
    } else if (nextType === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      nextValue = "";
    }

    setValueType(nextType);
    setValue(nextValue);
    if (cleanName && property) save(nextType, nextValue);
  };

  const errorMessage = duplicate
    ? "A property with this name already exists."
    : "Use letters, numbers, spaces, hyphens, or underscores.";

  return (
    <div
      className="group px-1 py-0.5"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !property && !nameMenuOpen) onCancel?.();
      }}
      onBlur={(event) => {
        if (skipNextRowBlurRef.current) {
          skipNextRowBlurRef.current = false;
          return;
        }
        if (nameMenuOpenRef.current) return;
        if (
          event.currentTarget.contains(
            event.relatedTarget instanceof Node ? event.relatedTarget : null,
          )
        ) return;
        if (!cleanName && !property) return;
        save();
      }}
    >
      <div className="flex min-h-9 items-start gap-2">
        <PropertyNameMenu
          name={name}
          type={valueType}
          open={nameMenuOpen}
          invalid={invalid}
          errorMessage={errorMessage}
          onOpenChange={updateNameMenuOpen}
          onDismiss={(reason) => {
            if (dismissCommittedRef.current) return;
            if (!cleanName && !property) {
              dismissCommittedRef.current = true;
              skipNextRowBlurRef.current = reason === "outside-press";
              updateNameMenuOpen(false);
              onCancel?.();
              return;
            }
            if (save()) {
              dismissCommittedRef.current = true;
              skipNextRowBlurRef.current = reason === "outside-press";
              updateNameMenuOpen(false);
            }
          }}
          onNameChange={(nextName) => {
            setName(nextName);
            setInvalid(false);
          }}
          onNameSubmit={() => {
            if (!validName) {
              setInvalid(true);
              return;
            }
            if (property) save();
            updateNameMenuOpen(false);
            requestAnimationFrame(() => valueRef.current?.focus());
          }}
          onTypeChange={selectType}
        />

        <div className="min-w-0 flex-1">
          <PropertyValueEditor
            ref={(node) => {
              valueRef.current = node;
            }}
            type={valueType}
            value={value}
            name={cleanName}
            onChange={setValue}
            onCommit={(nextValue) => save(valueType, nextValue)}
          />
        </div>

        <Tooltip label={property ? "Delete property" : "Cancel"} side="top">
          <button
            type="button"
            onClick={() => (property ? onRemove(property.key) : onCancel?.())}
            className="grid h-9 w-8 shrink-0 place-items-center rounded-md text-faint opacity-0 transition-[opacity,color,background-color,scale] duration-100 hover:bg-active hover:text-danger group-hover:opacity-100 focus-visible:opacity-100 active:scale-[0.96]"
          >
            {property ? (
              <Trash2 size={13} strokeWidth={1.8} />
            ) : (
              <X size={14} strokeWidth={1.9} />
            )}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
