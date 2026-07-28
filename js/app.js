
/* ==========================================
   Competitive Exam App
   Part 1 : App Initialization
========================================== */

"use strict";

/* ---------- Global App ---------- */

const APP = {

    dataFolder: "data",

    currentCategory: null,

    currentSubject: null,

    currentChapter: null,

    currentPage: null,

    mockQuestions: [],

    answers: {},

    timer: null,

    timeLeft: 0

};


/* ---------- URL ---------- */

const url = new URL(window.location.href);

APP.currentCategory = url.searchParams.get("category");

APP.currentSubject = url.searchParams.get("subject");

APP.currentChapter = url.searchParams.get("chapter");


/* ---------- Shortcuts ---------- */

const $ = (selector) => document.querySelector(selector);

const $$ = (selector) => document.querySelectorAll(selector);


/* ---------- JSON Loader ---------- */

async function loadJSON(path){

    try{

        const response = await fetch(path);

        if(!response.ok){

            throw new Error(path);

        }

        return await response.json();

    }

    catch(error){

        console.error(error);

        return [];

    }

}


/* ---------- Page Detect ---------- */

const page = location.pathname.split("/").pop();

APP.currentPage = page;


/* ---------- Auto Start ---------- */

document.addEventListener("DOMContentLoaded",()=>{

    console.log("Competitive Exam App Started");

    console.log(APP);

});
