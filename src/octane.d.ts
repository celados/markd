type NativeEvent<T extends EventTarget, E extends Event = Event> = E & {
	currentTarget: T & EventTarget;
};
