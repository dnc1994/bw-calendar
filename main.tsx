import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, ItemView, TFile, TFolder, normalizePath } from 'obsidian';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';

interface BWCalendarSettings {
	logsFolder: string;
	debugMode: boolean;
}

const DEFAULT_SETTINGS: BWCalendarSettings = {
	logsFolder: 'Logs/BM',
	debugMode: false
}

const VIEW_TYPE_BW_CALENDAR = "bw-calendar-view";

interface BMEvent {
	time: string;
	notes: string;
	originalDate: string; // from filename YYYY-MM-DD
}

export default class BWCalendarPlugin extends Plugin {
	settings: BWCalendarSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_BW_CALENDAR,
			(leaf) => new BWCalendarView(leaf, this)
		);

		this.addRibbonIcon('calendar-days', 'Bowel Movement Calendar', () => {
			this.activateView();
		});

		this.addSettingTab(new BWCalendarSettingTab(this.app, this));

		this.addCommand({
			id: 'open-bw-calendar',
			name: 'Open Calendar',
			callback: () => {
				this.activateView();
			}
		});
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_BW_CALENDAR);

		if (leaves.length > 0) {
			leaf = leaves[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			if (leaf) {
				await leaf.setViewState({ type: VIEW_TYPE_BW_CALENDAR, active: true });
			}
		}

		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class BWCalendarView extends ItemView {
	plugin: BWCalendarPlugin;
	root: Root | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: BWCalendarPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE_BW_CALENDAR;
	}

	getDisplayText() {
		return "BW Calendar";
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('bw-calendar-container');
		this.root = createRoot(container);
		this.render();
	}

	async onClose() {
		this.root?.unmount();
	}

	render() {
		if (this.root) {
			this.root.render(
				<CalendarComponent app={this.app} settings={this.plugin.settings} />
			);
		}
	}
}

function CalendarComponent({ app, settings }: { app: App, settings: BWCalendarSettings }) {
	const [currentDate, setCurrentDate] = React.useState(new Date());
	const [events, setEvents] = React.useState<Record<string, BMEvent[]>>({});
	const [selectedDate, setSelectedDate] = React.useState<string | null>(null);
	const [error, setError] = React.useState<string | null>(null);

	const loadEvents = React.useCallback(async () => {
		if (settings.debugMode) console.log("BW Calendar: Loading events from", settings.logsFolder);
		const folder = app.vault.getAbstractFileByPath(normalizePath(settings.logsFolder));
		
		if (!folder) {
			setError(`Folder not found: "${settings.logsFolder}". Please check your settings.`);
			setEvents({});
			return;
		}

		if (!(folder instanceof TFolder)) {
			setError(`Path is not a folder: "${settings.logsFolder}".`);
			setEvents({});
			return;
		}

		setError(null);
		const newEvents: Record<string, BMEvent[]> = {};
		const files = folder.children.filter(f => f instanceof TFile && f.extension === 'md');
		if (settings.debugMode) console.log(`BW Calendar: Found ${files.length} markdown files in folder.`);

		for (const file of files) {
			if (!(file instanceof TFile)) continue;
			
			// Strictly match YYYY-MM-DD
			const dateMatch = file.basename.match(/^(\d{4}-\d{2}-\d{2})$/);
			if (!dateMatch) {
				console.log("BW Calendar: Skipping file (doesn't match YYYY-MM-DD):", file.basename);
				continue;
			}

			const dateStr = dateMatch[1];
			const content = await app.vault.read(file);
			if (settings.debugMode) console.log(`BW Calendar: Parsing ${file.basename}, content length: ${content.length}`);
			
			// Split by --- at the start of a line
			const blocks = content.split(/^---/m).map(b => b.trim()).filter(b => b.length > 0);
			
			const dayEvents: BMEvent[] = [];
			for (const block of blocks) {
				const lines = block.split('\n');
				let time = "";
				let notes = "";

				for (const line of lines) {
					// Handle "time: " or "time: time: "
					const tMatch = line.match(/^time:\s*(.*)$/i);
					if (tMatch) {
						time = tMatch[1].trim().replace(/^time:\s*/i, '');
						continue;
					}
					const nMatch = line.match(/^notes:\s*(.*)$/i);
					if (nMatch) {
						notes = nMatch[1].trim().replace(/^"(.*)"$/, '$1');
						continue;
					}
				}
				
				if (time) {
					dayEvents.push({
						time: time,
						notes: notes,
						originalDate: dateStr
					});
				}
			}
			if (dayEvents.length > 0) {
				if (settings.debugMode) console.log(`BW Calendar: Found ${dayEvents.length} events for ${dateStr}`);
				newEvents[dateStr] = dayEvents;
			} else {
				if (settings.debugMode) console.log(`BW Calendar: No valid events found in ${file.basename}`);
			}
		}
		setEvents(newEvents);
	}, [app, settings.logsFolder]);

	React.useEffect(() => {
		loadEvents();

		const onModify = (file: any) => {
			if (file instanceof TFile && file.path.startsWith(settings.logsFolder)) {
				loadEvents();
			}
		};

		app.vault.on('modify', onModify);
		app.vault.on('create', onModify);
		app.vault.on('delete', onModify);
		app.vault.on('rename', onModify);

		return () => {
			app.vault.off('modify', onModify);
			app.vault.off('create', onModify);
			app.vault.off('delete', onModify);
			app.vault.off('rename', onModify);
		};
	}, [loadEvents, app.vault, settings.logsFolder]);

	const changeMonth = (offset: number) => {
		const next = new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1);
		setCurrentDate(next);
		setSelectedDate(null);
	};

	const year = currentDate.getFullYear();
	const month = currentDate.getMonth();
	const firstDay = new Date(year, month, 1).getDay();
	const daysInMonth = new Date(year, month + 1, 0).getDate();
	const monthName = currentDate.toLocaleString('default', { month: 'long' });

	const formatTime = (timeStr: string) => {
		const cleanTime = timeStr.replace(/^time:\s*/i, '').trim();
		try {
			const date = new Date(cleanTime);
			if (isNaN(date.getTime())) return cleanTime;
			return date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
		} catch (e) {
			return cleanTime;
		}
	};

	const isToday = (d: number) => {
		const now = new Date();
		return now.getFullYear() === year && now.getMonth() === month && now.getDate() === d;
	};

	const days = [];
	for (let i = 0; i < firstDay; i++) {
		days.push(<div key={`empty-${i}`} className="bw-day empty"></div>);
	}

	for (let d = 1; d <= daysInMonth; d++) {
		const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
		const dayEvents = events[dateStr] || [];
		const hasEvents = dayEvents.length > 0;
		const today = isToday(d);
		
		const dayDate = new Date(year, month, d);
		const isFuture = dayDate > new Date();

		days.push(
			<div 
				key={d} 
				className={`bw-day ${hasEvents ? 'has-events' : ''} ${selectedDate === dateStr ? 'selected' : ''} ${today ? 'is-today' : ''} ${isFuture ? 'is-future' : ''}`}
				onClick={() => setSelectedDate(dateStr)}
			>
				<div className="bw-day-number">{d}</div>
				{hasEvents && <div className="bw-event-count">{dayEvents.length}</div>}
			</div>
		);
	}

	return (
		<div className="bw-calendar-wrapper">
			{error ? (
				<div className="bw-error-message" style={{color: 'var(--text-error)', padding: '20px', textAlign: 'center'}}>
					{error}
				</div>
			) : (
				<>
					<div className="bw-calendar-header">
						<div className="bw-nav-buttons">
							<button onClick={() => changeMonth(-1)}>&lt;</button>
							<button onClick={() => {
								const today = new Date();
								setCurrentDate(today);
								setSelectedDate(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`);
							}}>Today</button>
							<button onClick={() => changeMonth(1)}>&gt;</button>
						</div>
						<h2>{monthName} {year}</h2>
					</div>
					<div className="bw-calendar-grid">
						{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
							<div key={d} className="bw-weekday">{d}</div>
						))}
						{days}
					</div>
					{selectedDate && (
						<div className="bw-day-details">
							<h3>Events for {selectedDate}</h3>
							<div className="bw-event-list">
								{events[selectedDate] && events[selectedDate].length > 0 ? (
									events[selectedDate].map((ev, i) => (
										<div key={i} className="bw-event-item">
											<div className="bw-event-time">{formatTime(ev.time)}</div>
											<div className="bw-event-notes">{ev.notes}</div>
										</div>
									))
								) : (
									<p>No events logged.</p>
								)}
							</div>
							<button className="mod-cta" onClick={async () => {
								const filePath = normalizePath(`${settings.logsFolder}/${selectedDate}.md`);
								const file = app.vault.getAbstractFileByPath(filePath);
								if (file instanceof TFile) {
									const leaf = app.workspace.getLeaf(false);
									await leaf.openFile(file);
								} else {
									console.error("File not found at path:", filePath);
								}
							}}>Open File</button>
						</div>
					)}
				</>
			)}
			{settings.debugMode && (
				<div className="bw-debug-info" style={{marginTop: '20px', fontSize: '0.8em', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: '10px'}}>
					<h4>Debug Info</h4>
					<p>Logs Folder: {settings.logsFolder}</p>
					<p>Files found: {Object.keys(events).length}</p>
					<ul>
						{Object.keys(events).map(date => (
							<li key={date}>{date}: {events[date].length} events</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

class BWCalendarSettingTab extends PluginSettingTab {
	plugin: BWCalendarPlugin;

	constructor(app: App, plugin: BWCalendarPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Logs folder')
			.setDesc('The folder where your daily bowel movement logs are stored (e.g. Logs/BM)')
			.addText(text => text
				.setPlaceholder('Enter folder path')
				.setValue(this.plugin.settings.logsFolder)
				.onChange(async (value) => {
					this.plugin.settings.logsFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Debug mode')
			.setDesc('Show debug information in the calendar view and console.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.debugMode)
				.onChange(async (value) => {
					this.plugin.settings.debugMode = value;
					await this.plugin.saveSettings();
				}));
	}
}
