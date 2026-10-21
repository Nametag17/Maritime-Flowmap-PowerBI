"use strict";

/**
 * Map themes. Flow colors were validated with the dataviz palette checker against each theme's land
 * and ocean (all-pairs, since any two flows can sit side by side on a map): the dark themes pass
 * every check; Light passes but with contrast below 3:1, so labels must stay on there.
 */
export interface MapTheme {
    ocean: string;
    land: string;
    coast: string;
    border: string;
    state: string;
    countryLabel: string;
    seaLabel: string;
    text: string;
    textMuted: string;
    halo: string;
    casing: string;
    panel: string;
    panelBorder: string;
    destination: string;
    other: string;
    series: string[];
}

export type ThemeName = "navy" | "midnight" | "light";

export const THEMES: Record<ThemeName, MapTheme> = {
    navy: {
        ocean: "#041d45", land: "#0d3270", coast: "#2c5aa0", border: "#5277b8", state: "#23508f",
        countryLabel: "#8c9cb5", seaLabel: "#5a80bd",
        text: "#f4faff", textMuted: "#8c9cb5", halo: "#041d45", casing: "#041d45",
        panel: "rgba(4, 29, 69, 0.88)", panelBorder: "rgba(140, 156, 181, 0.35)",
        destination: "#f4faff", other: "#8c9cb5",
        series: ["#e66c37", "#1baf7a", "#9085e9"]
    },
    midnight: {
        ocean: "#0d1117", land: "#1c232d", coast: "#343f4d", border: "#4a5666", state: "#2b3440",
        countryLabel: "#8b96a3", seaLabel: "#56657a",
        text: "#eef1f5", textMuted: "#8b96a3", halo: "#0d1117", casing: "#0d1117",
        panel: "rgba(13, 17, 23, 0.88)", panelBorder: "rgba(139, 150, 163, 0.35)",
        destination: "#eef1f5", other: "#8b96a3",
        series: ["#e66c37", "#1baf7a", "#9085e9"]
    },
    light: {
        ocean: "#d6e2ee", land: "#f4f4f1", coast: "#a9b8c8", border: "#9fb0c3", state: "#cfd8e2",
        countryLabel: "#5a6b85", seaLabel: "#6f89a8",
        text: "#0b1f3f", textMuted: "#5a6b85", halo: "#f4f4f1", casing: "#ffffff",
        panel: "rgba(255, 255, 255, 0.92)", panelBorder: "rgba(11, 31, 63, 0.18)",
        destination: "#0b1f3f", other: "#7c8796",
        series: ["#e66c37", "#1baf7a", "#6250d6"]
    }
};

export interface SeaLabel {
    name: string;
    lon: number;
    lat: number;
    minK: number;
    maxK?: number;
}

export const SEAS: SeaLabel[] = [
    { name: "Gulf of Mexico", lon: -90.3, lat: 25.2, minK: 5 },
    { name: "Caribbean Sea", lon: -75.5, lat: 14.6, minK: 5 },
    { name: "Sargasso Sea", lon: -64, lat: 27.5, minK: 12 },
    { name: "Atlantic Ocean", lon: -50, lat: 31, minK: 1, maxK: 40 },
    { name: "Pacific Ocean", lon: -122, lat: 12, minK: 1, maxK: 40 },
    { name: "Indian Ocean", lon: 78, lat: -18, minK: 1, maxK: 40 },
    { name: "Mediterranean Sea", lon: 18, lat: 34.5, minK: 6 },
    { name: "North Sea", lon: 3.5, lat: 56, minK: 8 },
    { name: "Arabian Sea", lon: 64, lat: 15, minK: 5 },
    { name: "Bay of Bengal", lon: 88, lat: 15, minK: 6 },
    { name: "South China Sea", lon: 114, lat: 14, minK: 6 },
    { name: "East China Sea", lon: 126, lat: 29, minK: 8 },
    { name: "Red Sea", lon: 38.5, lat: 20.5, minK: 10 },
    { name: "Persian Gulf", lon: 51.5, lat: 27, minK: 12 }
];

export const NAME_FIX: Record<string, string> = { "United States of America": "United States" };
